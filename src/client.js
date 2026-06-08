#!/usr/bin/env node

/**
 * TminusClient — Standalone Node.js client SDK for the t-minus cue dispatcher.
 *
 * Features:
 *   - WebSocket connection with auto-reconnect (exponential backoff, up to 3 tries)
 *   - Agent lifecycle: register → subscribe → cue → fire → report
 *   - Phase group management (join/leave, phase advance events)
 *   - Promisified API (each action returns a Promise resolving on the server ack)
 *   - Heartbeat ping every 10s
 *   - Full state machine tracking
 */

const EventEmitter = require('events');
const WebSocket = require('ws');

// Re-map the server constants locally for clarity
const STATE = {
  OFFLINE:    'offline',
  REGISTERED: 'registered',
  LISTENING:  'listening',
  CUED:       'cued',
  PRIMED:     'primed',
  FIRING:     'firing',
  COMPLETE:   'complete',
};

const MSG = {
  // Client → Server
  REGISTER:     'REGISTER',
  SUBSCRIBE:    'SUBSCRIBE',
  UNSUBSCRIBE:  'UNSUBSCRIBE',
  CUE:          'CUE',
  FIRE:         'FIRE',
  REPORT:       'REPORT',
  PING:         'PING',
  // Server → Client
  REGISTERED:   'REGISTERED',
  CUED:         'CUED',
  PRIMED:       'PRIMED',
  FIRE_ACK:     'FIRE_ACK',
  COMPLETE_ACK: 'COMPLETE_ACK',
  PHASE_ADVANCE:'PHASE_ADVANCE',
  ERROR:        'ERROR',
  PONG:         'PONG',
};

const VALID_UP_TRANSITIONS = {
  [STATE.OFFLINE]:    [STATE.REGISTERED],
  [STATE.REGISTERED]: [STATE.LISTENING],
  [STATE.LISTENING]:  [STATE.CUED, STATE.PRIMED],
  [STATE.CUED]:       [STATE.PRIMED, STATE.LISTENING],
  [STATE.PRIMED]:     [STATE.FIRING, STATE.LISTENING],
  [STATE.FIRING]:     [STATE.COMPLETE, STATE.LISTENING],
  [STATE.COMPLETE]:   [STATE.LISTENING],
};

class TminusClient extends EventEmitter {
  /**
   * @param {string} [url='ws://localhost:8765']  Server WebSocket URL
   * @param {object}  [opts]
   * @param {number}  [opts.reconnectAttempts=3]   Max auto-reconnect attempts
   * @param {number}  [opts.reconnectDelay=1000]   Initial reconnect delay (ms)
   * @param {number}  [opts.pingInterval=10000]    Heartbeat interval (ms)
   */
  constructor(url, opts) {
    super();
    this._url = url || 'ws://localhost:8765';
    this._opts = Object.assign({
      reconnectAttempts: 3,
      reconnectDelay: 1000,
      pingInterval: 10000,
    }, opts);

    /** @private */
    this._ws = null;
    this._seq = 0;
    this._agentId = null;
    this._state = STATE.OFFLINE;
    this._phaseGroups = [];
    this._pending = new Map();       // seq → { resolve, reject, type }
    this._reconnectCount = 0;
    this._reconnectTimer = null;
    this._pingTimer = null;
    this._intentionalClose = false;
    this._debug = false;
  }

  // ── Public accessors ────────────────────────────────────────────────

  /** Current agent ID (null until registered). */
  get agentId() { return this._agentId; }

  /** Current lifecycle state. */
  get state() { return this._state; }

  /** Phase groups this agent is subscribed to. */
  get phaseGroups() { return [...this._phaseGroups]; }

  /** Whether the client is currently connected. */
  get connected() { return this._ws !== null && this._ws.readyState === WebSocket.OPEN; }

  /** Enable verbose debug logging. */
  set debug(v) { this._debug = !!v; }

  // ── Connection ──────────────────────────────────────────────────────

  /**
   * Open the WebSocket connection.
   * @returns {Promise<void>} resolves when socket opens
   */
  connect() {
    return new Promise((resolve, reject) => {
      if (this._ws && this._ws.readyState === WebSocket.OPEN) {
        resolve();
        return;
      }

      this._intentionalClose = false;
      this._log('connect', `Connecting to ${this._url} ...`);

      const ws = new WebSocket(this._url);

      ws.on('open', () => {
        this._ws = ws;
        this._reconnectCount = 0;
        this._startPing();
        this._log('connect', 'Connected');
        this.emit('connected');
        resolve();
      });

      ws.on('message', (raw) => {
        try {
          const msg = JSON.parse(raw.toString());
          this._handleMessage(msg);
        } catch (e) {
          this._log('warn', `Failed to parse message: ${e.message}`);
        }
      });

      ws.on('close', (code, reason) => {
        this._log('connect', `Closed (code=${code}, reason=${reason || 'none'})`);
        this._stopPing();
        this._ws = null;
        this._rejectAllPending(new Error('Connection closed'));
        this._onDisconnected();
        if (!this._intentionalClose) {
          this._autoReconnect();
        }
      });

      ws.on('error', (err) => {
        this._log('error', `WebSocket error: ${err.message}`);
        // The close event will fire next, triggering reconnect logic
        this.emit('error', err);
        reject(err);
      });
    });
  }

  /**
   * Disconnect cleanly.
   */
  disconnect() {
    this._intentionalClose = true;
    this._stopPing();
    this._cancelReconnect();
    if (this._ws) {
      try { this._ws.close(); } catch (_) { /* ignore */ }
      this._ws = null;
    }
    this._rejectAllPending(new Error('Client disconnected'));
    this._setState(STATE.OFFLINE);
    this._agentId = null;
    this.emit('disconnected');
  }

  // ── Agent Lifetime ──────────────────────────────────────────────────

  /**
   * Register this agent with the dispatcher.
   * @param {string} name  Agent display name
   * @param {object} [opts]
   * @param {string} [opts.timbre='neutral']
   * @param {number} [opts.frequency=1.0]
   * @param {number} [opts.latency_ms]
   * @param {string} [opts.context_depth='medium']  shallow|medium|deep
   * @returns {Promise<object>}  REGISTERED payload
   */
  register(name, opts = {}) {
    return this._send(MSG.REGISTER, {
      name,
      timbre: opts.timbre || 'neutral',
      frequency: typeof opts.frequency === 'number' ? opts.frequency : 1.0,
      latency_ms: opts.latency_ms,
      context_depth: opts.context_depth || 'medium',
    }, MSG.REGISTERED).then((payload) => {
      this._agentId = payload.agent_id;
      this._setState(STATE.REGISTERED);
      if (payload.phase_groups) this._phaseGroups = payload.phase_groups;
      this.emit('registered', payload);
      return payload;
    });
  }

  /**
   * Subscribe to one or more phase groups.
   * @param {string|string[]} phaseGroups  One or more group names
   * @returns {Promise<object>}
   */
  subscribe(phaseGroups) {
    const groups = Array.isArray(phaseGroups) ? phaseGroups : [phaseGroups];
    return this._send(MSG.SUBSCRIBE, { phase_groups: groups }, MSG.REGISTERED)
      .then((payload) => {
        this._phaseGroups = payload.phase_groups || [];
        if (this._state === STATE.REGISTERED || this._state === STATE.COMPLETE) {
          this._setState(STATE.LISTENING);
        }
        this.emit('subscribed', payload);
        return payload;
      });
  }

  /**
   * Unsubscribe from phase groups.
   * @param {string|string[]} phaseGroups
   * @returns {Promise<object>}
   */
  unsubscribe(phaseGroups) {
    const groups = Array.isArray(phaseGroups) ? phaseGroups : [phaseGroups];
    return this._send(MSG.UNSUBSCRIBE, { phase_groups: groups }, MSG.REGISTERED)
      .then((payload) => {
        this._phaseGroups = payload.phase_groups || [];
        if (this._phaseGroups.length === 0 && this._state !== STATE.OFFLINE) {
          this._setState(STATE.REGISTERED);
        }
        this.emit('unsubscribed', payload);
        return payload;
      });
  }

  /**
   * Send a t-minus cue to another agent.
   * @param {string} targetId      Target agent ID
   * @param {number} offsetBeats   T-minus offset (negative = pre-cue, zero = immediate, positive = countdown)
   * @param {string} phaseGroup    Phase group name
   * @param {object} [payload]     Optional context payload
   * @returns {Promise<object>}
   */
  cue(targetId, offsetBeats, phaseGroup, payload) {
    return this._send(MSG.CUE, {
      target_id: targetId,
      offset_beats: offsetBeats,
      phase_group: phaseGroup,
      payload: payload || null,
    }, MSG.REGISTERED).then((result) => {
      this.emit('cue_sent', result);
      return result;
    });
  }

  /**
   * Fire the current cue (agent must be in PRIMED state).
   * @returns {Promise<object>}
   */
  fire() {
    return this._send(MSG.FIRE, {}, MSG.FIRE_ACK).then((payload) => {
      this._setState(STATE.FIRING);
      this.emit('fire_ack', payload);
      return payload;
    });
  }

  /**
   * Report completion back to the dispatcher.
   * @param {string}  result       Outcome string (e.g. 'ok', 'fail')
   * @param {string}  phaseGroup   Phase group this report pertains to
   * @param {number}  [durationBeats=0]
   * @returns {Promise<object>}
   */
  report(result, phaseGroup, durationBeats = 0) {
    return this._send(MSG.REPORT, {
      result,
      phase_group: phaseGroup,
      duration_beats: durationBeats,
    }, MSG.COMPLETE_ACK).then((payload) => {
      this._setState(STATE.COMPLETE);
      this.emit('complete', payload);
      return payload;
    });
  }

  /**
   * Convenience: fire and report in one call (auto-fires if PRIMED).
   * @param {string}  result
   * @param {string}  phaseGroup
   * @param {number}  [durationBeats=0]
   * @returns {Promise<object>}
   */
  fireAndReport(result, phaseGroup, durationBeats = 0) {
    return this.fire()
      .then(() => this.report(result, phaseGroup, durationBeats));
  }

  /**
   * Wait for the next CUED message.
   * @param {number} [timeoutMs=30000]  Max wait before rejecting
   * @returns {Promise<object>}  The CUED payload
   */
  awaitCue(timeoutMs = 30000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.removeListener('cued', handler);
        reject(new Error('Cue timeout'));
      }, timeoutMs);
      const handler = (payload) => {
        clearTimeout(timer);
        resolve(payload);
      };
      this.once('cued', handler);
    });
  }

  // ── Internal: message send / receive ─────────────────────────────────

  /**
   * Send a message and wait for a matching server response.
   * @param {string} type       Client message type
   * @param {object} payload    Message payload
   * @param {string} respType   Expected server response type
   * @returns {Promise<object>} The response payload
   */
  _send(type, payload, respType) {
    return new Promise((resolve, reject) => {
      if (!this.connected) {
        reject(new Error('Not connected'));
        return;
      }
      const seq = ++this._seq;
      const msg = JSON.stringify({ type, seq, ts: Date.now(), payload });
      this._pending.set(seq, { resolve, reject, type: respType });
      this._log('send', `[${seq}] ${type}`);
      try {
        this._ws.send(msg);
      } catch (e) {
        this._pending.delete(seq);
        reject(e);
      }
    });
  }

  /**
   * Incoming message router.
   */
  _handleMessage(msg) {
    const { type, payload, seq } = msg;

    this._log('recv', `[${seq || '-'}] ${type}`, payload ? JSON.stringify(payload).slice(0, 120) : '');

    // Resolve any pending promise keyed by seq or type
    if (seq && this._pending.has(seq)) {
      const pend = this._pending.get(seq);
      if (pend.type === type || pend.type === 'ANY') {
        this._pending.delete(seq);
        pend.resolve(payload || {});
        return;
      }
    }

    // Fallback: resolve by type (for messages that arrive without seq match)
    for (const [s, pend] of this._pending) {
      if (pend.type === type) {
        this._pending.delete(s);
        pend.resolve(payload || {});
        return;
      }
    }

    // Event-driven messages
    switch (type) {
      case MSG.CUED:
        this._setState(STATE.CUED);
        this.emit('cued', payload);
        break;

      case MSG.PRIMED:
        this._setState(STATE.PRIMED);
        this.emit('primed', payload);
        break;

      case MSG.FIRE_ACK:
        this._setState(STATE.FIRING);
        this.emit('fire_ack', payload);
        break;

      case MSG.COMPLETE_ACK:
        this._setState(STATE.COMPLETE);
        this.emit('complete', payload);
        break;

      case MSG.PHASE_ADVANCE:
        this.emit('phase_advance', payload);
        break;

      case MSG.PONG:
        this.emit('pong', payload);
        break;

      case MSG.ERROR:
        this.emit('server_error', payload);
        break;

      default:
        this._log('warn', `Unhandled message type: ${type}`, JSON.stringify(msg).slice(0, 100));
    }
  }

  // ── State machine ───────────────────────────────────────────────────

  _setState(newState) {
    const prev = this._state;
    if (prev === newState) return;
    if (!VALID_UP_TRANSITIONS[prev] || !VALID_UP_TRANSITIONS[prev].includes(newState)) {
      this._log('warn', `Invalid state transition: ${prev} → ${newState}`);
    }
    this._state = newState;
    this._log('state', `${prev} → ${newState}`);
    this.emit('state_change', { from: prev, to: newState });
  }

  // ── Heartbeat ────────────────────────────────────────────────────────

  _startPing() {
    this._stopPing();
    this._pingTimer = setInterval(() => {
      if (this.connected) {
        this._sendRaw({ type: MSG.PING, ts: Date.now(), payload: {} });
      }
    }, this._opts.pingInterval);
  }

  _stopPing() {
    if (this._pingTimer) {
      clearInterval(this._pingTimer);
      this._pingTimer = null;
    }
  }

  _sendRaw(msg) {
    if (!this.connected) return;
    try {
      this._ws.send(JSON.stringify(msg));
    } catch (_) { /* ignore */ }
  }

  // ── Auto-reconnect ──────────────────────────────────────────────────

  _onDisconnected() {
    this._setState(STATE.OFFLINE);
    this.emit('disconnected');
  }

  _autoReconnect() {
    if (this._reconnectCount >= this._opts.reconnectAttempts) {
      this._log('connect', 'Max reconnect attempts reached');
      this.emit('reconnect_failed');
      return;
    }

    this._reconnectCount++;
    const delay = this._opts.reconnectDelay * Math.pow(2, this._reconnectCount - 1);
    this._log('connect', `Reconnecting in ${delay}ms (attempt ${this._reconnectCount}/${this._opts.reconnectAttempts})`);

    this._cancelReconnect();
    this._reconnectTimer = setTimeout(() => {
      this.connect().catch((err) => {
        this._log('error', `Reconnect attempt ${this._reconnectCount} failed: ${err.message}`);
      });
    }, delay);
  }

  _cancelReconnect() {
    if (this._reconnectTimer) {
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = null;
    }
  }

  // ── Pending promise cleanup ─────────────────────────────────────────

  _rejectAllPending(err) {
    for (const [seq, pend] of this._pending) {
      pend.reject(err);
    }
    this._pending.clear();
  }

  // ── Logging ─────────────────────────────────────────────────────────

  _log(tag, ...args) {
    if (tag === 'send' || tag === 'recv' || tag === 'state' || tag === 'connect' || this._debug) {
      const prefix = `[TminusClient] [${tag.toUpperCase()}]`;
      if (tag === 'error') {
        console.error(prefix, ...args);
      } else {
        console.log(prefix, ...args);
      }
    } else if (this._debug) {
      console.log(`[TminusClient] [${tag.toUpperCase()}]`, ...args);
    }
  }
}

// ── Exports ────────────────────────────────────────────────────────────
TminusClient.STATE = STATE;
TminusClient.MSG = MSG;

module.exports = { TminusClient, STATE, MSG };
