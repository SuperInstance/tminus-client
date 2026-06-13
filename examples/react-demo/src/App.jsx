import React, { useState, useEffect, useRef, useCallback } from 'react';
import { TminusClient, STATE } from '@superinstance/tminus-client';

// ── State machine diagram config ──────────────────────────────────────
const STATES = [
  STATE.OFFLINE,
  STATE.REGISTERED,
  STATE.LISTENING,
  STATE.CUED,
  STATE.PRIMED,
  STATE.FIRING,
  STATE.COMPLETE,
];

const STATE_COLORS = {
  [STATE.OFFLINE]:    '#4a4a5a',
  [STATE.REGISTERED]: '#3b82f6',
  [STATE.LISTENING]:  '#8b5cf6',
  [STATE.CUED]:       '#f59e0b',
  [STATE.PRIMED]:     '#ef4444',
  [STATE.FIRING]:     '#22c55e',
  [STATE.COMPLETE]:   '#06b6d4',
};

const STATE_ICONS = {
  [STATE.OFFLINE]:    '⬤',
  [STATE.REGISTERED]: '◉',
  [STATE.LISTENING]:  '◈',
  [STATE.CUED]:       '◆',
  [STATE.PRIMED]:     '▲',
  [STATE.FIRING]:     '⚡',
  [STATE.COMPLETE]:   '✓',
};

// ── Styles ────────────────────────────────────────────────────────────

const styles = {
  container: {
    maxWidth: 960,
    margin: '0 auto',
    padding: '32px 24px',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    marginBottom: 32,
  },
  logo: {
    fontSize: 28,
    fontWeight: 700,
    color: '#e4e4ef',
    letterSpacing: '-0.5px',
  },
  version: {
    fontSize: 12,
    color: '#4a4a5a',
    background: '#1a1a24',
    padding: '2px 8px',
    borderRadius: 4,
  },
  subtitle: {
    fontSize: 13,
    color: '#6a6a7a',
    marginTop: 4,
  },

  // State machine panel
  stateMachine: {
    background: '#0e0e18',
    border: '1px solid #1e1e2e',
    borderRadius: 12,
    padding: 24,
    marginBottom: 24,
  },
  panelTitle: {
    fontSize: 11,
    fontWeight: 600,
    color: '#5a5a6e',
    textTransform: 'uppercase',
    letterSpacing: '1.5px',
    marginBottom: 20,
  },
  stateFlow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 0,
    flexWrap: 'wrap',
  },
  stateNode: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 8,
    position: 'relative',
  },
  stateCircle: (active, color) => ({
    width: 56,
    height: 56,
    borderRadius: '50%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: active ? 22 : 16,
    fontWeight: 700,
    color: active ? '#fff' : '#3a3a4a',
    background: active
      ? `radial-gradient(circle at 40% 40%, ${color}cc, ${color}66)`
      : '#14141e',
    border: active ? `2px solid ${color}` : '2px solid #1e1e2e',
    boxShadow: active ? `0 0 20px ${color}44, 0 0 40px ${color}22` : 'none',
    transition: 'all 0.3s ease',
  }),
  stateLabel: (active) => ({
    fontSize: active ? 11 : 10,
    fontWeight: active ? 600 : 400,
    color: active ? '#e4e4ef' : '#4a4a5a',
    textAlign: 'center',
    transition: 'all 0.3s ease',
  }),
  arrow: {
    fontSize: 16,
    color: '#2a2a3a',
    margin: '0 6px',
    paddingBottom: 20,
  },

  // Controls
  controls: {
    display: 'flex',
    gap: 12,
    marginBottom: 24,
    flexWrap: 'wrap',
  },
  button: (enabled, color = '#3b82f6') => ({
    padding: '10px 20px',
    fontSize: 13,
    fontFamily: 'inherit',
    fontWeight: 600,
    color: enabled ? '#fff' : '#3a3a4a',
    background: enabled ? `${color}22` : '#0e0e18',
    border: `1px solid ${enabled ? `${color}55` : '#1e1e2e'}`,
    borderRadius: 8,
    cursor: enabled ? 'pointer' : 'not-allowed',
    opacity: enabled ? 1 : 0.5,
    transition: 'all 0.2s ease',
  }),

  // Connection bar
  connectionBar: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    background: '#0e0e18',
    border: '1px solid #1e1e2e',
    borderRadius: 8,
    padding: '10px 16px',
    marginBottom: 24,
    fontSize: 12,
  },
  statusDot: (connected) => ({
    width: 8,
    height: 8,
    borderRadius: '50%',
    background: connected ? '#22c55e' : '#ef4444',
    boxShadow: connected ? '0 0 6px #22c55e44' : '0 0 6px #ef444444',
  }),

  // Event log
  logPanel: {
    background: '#08080e',
    border: '1px solid #1e1e2e',
    borderRadius: 12,
    overflow: 'hidden',
  },
  logHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '12px 16px',
    borderBottom: '1px solid #1e1e2e',
  },
  logBody: {
    padding: 12,
    maxHeight: 300,
    overflowY: 'auto',
    fontSize: 12,
    lineHeight: 1.8,
  },
  logLine: (type) => {
    const colors = {
      info: '#6a6a7a',
      event: '#8b5cf6',
      state: '#3b82f6',
      error: '#ef4444',
      send: '#f59e0b',
    };
    return { color: colors[type] || '#6a6a7a' };
  },
  logTimestamp: {
    color: '#2a2a3a',
    marginRight: 8,
  },

  // Agent info
  agentInfo: {
    display: 'flex',
    gap: 16,
    marginBottom: 24,
    flexWrap: 'wrap',
  },
  infoCard: {
    background: '#0e0e18',
    border: '1px solid #1e1e2e',
    borderRadius: 8,
    padding: '12px 16px',
    flex: '1 1 140px',
  },
  infoLabel: {
    fontSize: 10,
    fontWeight: 600,
    color: '#4a4a5a',
    textTransform: 'uppercase',
    letterSpacing: '1px',
    marginBottom: 4,
  },
  infoValue: {
    fontSize: 14,
    fontWeight: 600,
    color: '#e4e4ef',
    fontFamily: 'inherit',
  },
};

// ── App ───────────────────────────────────────────────────────────────

export default function App() {
  const [clientState, setClientState] = useState(STATE.OFFLINE);
  const [connected, setConnected] = useState(false);
  const [agentId, setAgentId] = useState(null);
  const [phaseGroups, setPhaseGroups] = useState([]);
  const [logs, setLogs] = useState([]);
  const [url, setUrl] = useState('ws://localhost:8765');
  const [agentName, setAgentName] = useState('demo-agent');
  const [cueTarget, setCueTarget] = useState('');
  const clientRef = useRef(null);
  const logRef = useRef(null);

  const addLog = useCallback((type, message) => {
    const ts = new Date().toLocaleTimeString('en-US', { hour12: false });
    setLogs((prev) => [...prev.slice(-199), { type, message, ts }]);
  }, []);

  // Auto-scroll log
  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [logs]);

  // Create client
  const getClient = useCallback(() => {
    if (clientRef.current) return clientRef.current;
    const client = new TminusClient(url);
    client.debug = true;

    client.on('connected', () => {
      setConnected(true);
      addLog('info', 'WebSocket connected');
    });

    client.on('disconnected', () => {
      setConnected(false);
      addLog('info', 'WebSocket disconnected');
    });

    client.on('state_change', ({ from, to }) => {
      setClientState(to);
      addLog('state', `${from} → ${to}`);
    });

    client.on('registered', (payload) => {
      setAgentId(payload.agent_id);
      addLog('event', `Registered as ${payload.agent_id}`);
    });

    client.on('cued', (payload) => {
      addLog('event', `CUED by ${payload.sender_id || 'dispatcher'} (offset: ${payload.offset_beats})`);
    });

    client.on('primed', (payload) => {
      addLog('event', `PRIMED — ready to fire`);
    });

    client.on('fire_ack', (payload) => {
      addLog('event', `FIRE acknowledged`);
    });

    client.on('complete', (payload) => {
      addLog('event', `COMPLETE`);
    });

    client.on('phase_advance', (payload) => {
      addLog('event', `Phase advance: ${payload.phase_group}`);
    });

    client.on('server_error', (payload) => {
      addLog('error', `Server error: ${payload.message || JSON.stringify(payload)}`);
    });

    client.on('error', (err) => {
      addLog('error', `Connection error: ${err.message}`);
    });

    clientRef.current = client;
    return client;
  }, [url, addLog]);

  // Actions
  const handleConnect = async () => {
    try {
      const client = getClient();
      await client.connect();
    } catch (err) {
      addLog('error', `Connect failed: ${err.message}`);
    }
  };

  const handleRegister = async () => {
    try {
      const client = getClient();
      if (!client.connected) await client.connect();
      const result = await client.register(agentName);
      addLog('send', `REGISTER → ${result.agent_id}`);
    } catch (err) {
      addLog('error', `Register failed: ${err.message}`);
    }
  };

  const handleSubscribe = async () => {
    try {
      const client = getClient();
      const result = await client.subscribe('default');
      setPhaseGroups(result.phase_groups || ['default']);
      addLog('send', `SUBSCRIBE → default`);
    } catch (err) {
      addLog('error', `Subscribe failed: ${err.message}`);
    }
  };

  const handleCue = async () => {
    if (!cueTarget) {
      addLog('error', 'Enter a target agent ID to cue');
      return;
    }
    try {
      const client = getClient();
      await client.cue(cueTarget, 0, 'default');
      addLog('send', `CUE → ${cueTarget} (phase: default)`);
    } catch (err) {
      addLog('error', `Cue failed: ${err.message}`);
    }
  };

  const handleFire = async () => {
    try {
      const client = getClient();
      await client.fire();
      addLog('send', 'FIRE → dispatched');
    } catch (err) {
      addLog('error', `Fire failed: ${err.message}`);
    }
  };

  const handleReport = async () => {
    try {
      const client = getClient();
      await client.report('ok', 'default', 1);
      addLog('send', 'REPORT → ok');
    } catch (err) {
      addLog('error', `Report failed: ${err.message}`);
    }
  };

  const handleDisconnect = () => {
    const client = getClient();
    client.disconnect();
    setAgentId(null);
    setPhaseGroups([]);
  };

  const currentState = clientState;

  return (
    <div style={styles.container}>
      {/* Header */}
      <div style={styles.header}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={styles.logo}>⏱ tminus-client</span>
            <span style={styles.version}>v1.0.0</span>
          </div>
          <div style={styles.subtitle}>React demo — connect, cue, fire, report</div>
        </div>
      </div>

      {/* Connection bar */}
      <div style={styles.connectionBar}>
        <span style={styles.statusDot(connected)} />
        <span style={{ color: connected ? '#22c55e' : '#ef4444', fontWeight: 600 }}>
          {connected ? 'CONNECTED' : 'DISCONNECTED'}
        </span>
        <span style={{ color: '#2a2a3a' }}>│</span>
        <span style={{ color: '#5a5a6e' }}>{url}</span>
        <div style={{ flex: 1 }} />
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="ws://localhost:8765"
          style={{
            background: '#0a0a12',
            border: '1px solid #1e1e2e',
            borderRadius: 4,
            padding: '4px 8px',
            fontSize: 11,
            fontFamily: 'inherit',
            color: '#c8c8d4',
            width: 200,
          }}
        />
        {!connected ? (
          <button style={styles.button(true, '#22c55e')} onClick={handleConnect}>
            Connect
          </button>
        ) : (
          <button style={styles.button(true, '#ef4444')} onClick={handleDisconnect}>
            Disconnect
          </button>
        )}
      </div>

      {/* Agent info */}
      <div style={styles.agentInfo}>
        <div style={styles.infoCard}>
          <div style={styles.infoLabel}>Agent ID</div>
          <div style={styles.infoValue}>{agentId || '—'}</div>
        </div>
        <div style={styles.infoCard}>
          <div style={styles.infoLabel}>State</div>
          <div style={{ ...styles.infoValue, color: STATE_COLORS[currentState] }}>
            {STATE_ICONS[currentState]} {currentState}
          </div>
        </div>
        <div style={styles.infoCard}>
          <div style={styles.infoLabel}>Phase Groups</div>
          <div style={styles.infoValue}>
            {phaseGroups.length > 0 ? phaseGroups.join(', ') : '—'}
          </div>
        </div>
      </div>

      {/* State machine diagram */}
      <div style={styles.stateMachine}>
        <div style={styles.panelTitle}>State Machine</div>
        <div style={styles.stateFlow}>
          {STATES.map((state, i) => (
            <React.Fragment key={state}>
              <div style={styles.stateNode}>
                <div style={styles.stateCircle(state === currentState, STATE_COLORS[state])}>
                  {STATE_ICONS[state]}
                </div>
                <div style={styles.stateLabel(state === currentState)}>{state}</div>
              </div>
              {i < STATES.length - 1 && (
                <div style={styles.arrow}>→</div>
              )}
            </React.Fragment>
          ))}
        </div>
      </div>

      {/* Controls */}
      <div style={styles.controls}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <input
            value={agentName}
            onChange={(e) => setAgentName(e.target.value)}
            placeholder="Agent name"
            style={{
              background: '#0a0a12',
              border: '1px solid #1e1e2e',
              borderRadius: 4,
              padding: '8px 12px',
              fontSize: 12,
              fontFamily: 'inherit',
              color: '#c8c8d4',
              width: 140,
            }}
          />
          <button
            style={styles.button(connected && currentState === STATE.OFFLINE, '#3b82f6')}
            onClick={handleRegister}
            disabled={!connected || currentState !== STATE.OFFLINE}
          >
            Register
          </button>
        </div>

        <button
          style={styles.button(
            currentState === STATE.REGISTERED || currentState === STATE.COMPLETE,
            '#8b5cf6'
          )}
          onClick={handleSubscribe}
          disabled={currentState !== STATE.REGISTERED && currentState !== STATE.COMPLETE}
        >
          Subscribe
        </button>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <input
            value={cueTarget}
            onChange={(e) => setCueTarget(e.target.value)}
            placeholder="Target agent ID"
            style={{
              background: '#0a0a12',
              border: '1px solid #1e1e2e',
              borderRadius: 4,
              padding: '8px 12px',
              fontSize: 12,
              fontFamily: 'inherit',
              color: '#c8c8d4',
              width: 160,
            }}
          />
          <button
            style={styles.button(currentState === STATE.LISTENING, '#f59e0b')}
            onClick={handleCue}
            disabled={currentState !== STATE.LISTENING}
          >
            Send Cue
          </button>
        </div>

        <button
          style={styles.button(currentState === STATE.PRIMED, '#ef4444')}
          onClick={handleFire}
          disabled={currentState !== STATE.PRIMED}
        >
          🔥 Fire
        </button>

        <button
          style={styles.button(currentState === STATE.FIRING, '#22c55e')}
          onClick={handleReport}
          disabled={currentState !== STATE.FIRING}
        >
          Report OK
        </button>
      </div>

      {/* Event log */}
      <div style={styles.logPanel}>
        <div style={styles.logHeader}>
          <span style={styles.panelTitle} style={{ ...styles.panelTitle, margin: 0 }}>
            Event Log
          </span>
          <button
            onClick={() => setLogs([])}
            style={{
              fontSize: 10,
              fontFamily: 'inherit',
              color: '#4a4a5a',
              background: 'none',
              border: '1px solid #1e1e2e',
              borderRadius: 4,
              padding: '2px 8px',
              cursor: 'pointer',
            }}
          >
            Clear
          </button>
        </div>
        <div style={styles.logBody} ref={logRef}>
          {logs.length === 0 && (
            <div style={{ color: '#2a2a3a' }}>No events yet. Connect to a dispatcher to begin.</div>
          )}
          {logs.map((log, i) => (
            <div key={i}>
              <span style={styles.logTimestamp}>{log.ts}</span>
              <span style={styles.logLine(log.type)}>{log.message}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
