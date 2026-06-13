import React, { useState, useEffect, useRef, useCallback } from 'react';
import { TminusClient, STATE, MSG } from '@superinstance/tminus-client';

// ── State machine layout ──────────────────────────────────────────────
const STATE_ORDER = [
  STATE.OFFLINE,
  STATE.REGISTERED,
  STATE.LISTENING,
  STATE.CUED,
  STATE.PRIMED,
  STATE.FIRING,
  STATE.COMPLETE,
];

const STATE_COLORS = {
  [STATE.OFFLINE]:    '#5c6a7a',
  [STATE.REGISTERED]: '#5bc0eb',
  [STATE.LISTENING]:  '#a78bfa',
  [STATE.CUED]:       '#f59e0b',
  [STATE.PRIMED]:     '#ff6b35',
  [STATE.FIRING]:     '#00e5a0',
  [STATE.COMPLETE]:   '#22d3ee',
};

const STATE_ICONS = {
  [STATE.OFFLINE]:    '⬤',
  [STATE.REGISTERED]: '◉',
  [STATE.LISTENING]:  '◎',
  [STATE.CUED]:       '◍',
  [STATE.PRIMED]:     '◆',
  [STATE.FIRING]:     '▸',
  [STATE.COMPLETE]:   '✓',
};

// ── Helpers ───────────────────────────────────────────────────────────
function ts() {
  return new Date().toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

// ── Components ────────────────────────────────────────────────────────

function StateMachineVisualization({ currentState }) {
  const activeIdx = STATE_ORDER.indexOf(currentState);

  return (
    <div style={{
      background: 'var(--surface)',
      border: '1px solid var(--border)',
      borderRadius: 12,
      padding: 24,
      marginBottom: 20,
    }}>
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-dim)', marginBottom: 16, textTransform: 'uppercase', letterSpacing: 2 }}>
        State Machine
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 0, flexWrap: 'wrap' }}>
        {STATE_ORDER.map((s, i) => {
          const active = s === currentState;
          const passed = i < activeIdx;
          const color = STATE_COLORS[s];
          return (
            <React.Fragment key={s}>
              {i > 0 && (
                <div style={{
                  width: 28,
                  height: 2,
                  background: passed ? color : 'var(--border)',
                  transition: 'background 0.3s',
                  flexShrink: 0,
                }} />
              )}
              <div style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 6,
                minWidth: 70,
              }}>
                <div style={{
                  width: 40,
                  height: 40,
                  borderRadius: '50%',
                  border: active ? `2px solid ${color}` : '2px solid var(--border)',
                  background: active ? `${color}22` : passed ? `${color}11` : 'transparent',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: active ? 18 : 14,
                  color: active ? color : passed ? `${color}88` : 'var(--text-dim)',
                  transition: 'all 0.3s ease',
                  boxShadow: active ? `0 0 20px ${color}44` : 'none',
                }}>
                  {active ? STATE_ICONS[s] : passed ? '·' : STATE_ICONS[s]}
                </div>
                <span style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: active ? 11 : 10,
                  color: active ? color : passed ? `${color}88` : 'var(--text-dim)',
                  fontWeight: active ? 600 : 400,
                  textTransform: 'uppercase',
                  letterSpacing: 0.5,
                }}>
                  {s}
                </span>
              </div>
            </React.Fragment>
          );
        })}
      </div>
    </div>
  );
}

function EventLog({ events }) {
  const logRef = useRef(null);
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [events]);

  return (
    <div style={{
      background: 'var(--surface)',
      border: '1px solid var(--border)',
      borderRadius: 12,
      overflow: 'hidden',
      flex: 1,
      display: 'flex',
      flexDirection: 'column',
      minHeight: 200,
    }}>
      <div style={{
        fontFamily: 'var(--font-mono)',
        fontSize: 11,
        color: 'var(--text-dim)',
        padding: '12px 16px',
        borderBottom: '1px solid var(--border)',
        textTransform: 'uppercase',
        letterSpacing: 2,
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
      }}>
        <span>Event Log</span>
        <span style={{ color: 'var(--accent)', fontSize: 10 }}>{events.length} events</span>
      </div>
      <div ref={logRef} style={{
        padding: 8,
        overflowY: 'auto',
        fontFamily: 'var(--font-mono)',
        fontSize: 12,
        lineHeight: 1.8,
        flex: 1,
      }}>
        {events.length === 0 && (
          <div style={{ color: 'var(--text-dim)', padding: 8 }}>No events yet. Connect to a dispatcher to begin.</div>
        )}
        {events.map((e, i) => {
          const color = e.level === 'error' ? 'var(--error)' : e.level === 'warn' ? 'var(--warn)' : e.level === 'success' ? 'var(--accent)' : 'var(--info)';
          return (
            <div key={i} style={{ display: 'flex', gap: 8 }}>
              <span style={{ color: 'var(--text-dim)', flexShrink: 0 }}>{e.ts}</span>
              <span style={{ color, flexShrink: 0, width: 60 }}>{e.tag}</span>
              <span style={{ color: 'var(--text)' }}>{e.msg}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ControlPanel({ client, state, agentId, addEvent, setClientState, phaseGroups }) {
  const [url, setUrl] = useState('ws://localhost:8765');
  const [name, setName] = useState('react-agent');
  const [phaseGroup, setPhaseGroup] = useState('main');
  const [targetId, setTargetId] = useState('');
  const [offsetBeats, setOffsetBeats] = useState(3);
  const clientRef = useRef(null);

  const addLog = useCallback((tag, msg, level = 'info') => {
    addEvent({ ts: ts(), tag, msg, level });
  }, [addEvent]);

  const handleConnect = useCallback(async () => {
    try {
      const c = new TminusClient(url);
      c.debug = true;
      clientRef.current = c;

      c.on('state_change', ({ from, to }) => {
        setClientState(to);
        addLog('STATE', `${from} → ${to}`, 'success');
      });

      c.on('connected', () => addLog('WS', 'Connected', 'success'));
      c.on('disconnected', () => addLog('WS', 'Disconnected', 'warn'));
      c.on('cued', (p) => addLog('CUED', `cue_id=${p.cue_id} source=${p.source} offset=${p.offset_beats}`, 'warn'));
      c.on('primed', (p) => addLog('PRIMED', `cue_id=${p.cue_id} — ready to fire!`, 'warn'));
      c.on('fire_ack', () => addLog('FIRE', 'Fire acknowledged', 'success'));
      c.on('complete', (p) => addLog('DONE', `Completed (total: ${p.cues_completed ?? '?'})`, 'success'));
      c.on('phase_advance', (p) => addLog('PHASE', `${p.group} → ${p.point}`, 'info'));
      c.on('server_error', (p) => addLog('ERR', `${p.code}: ${p.message}`, 'error'));

      await c.connect();
      addLog('WS', `Connecting to ${url}...`);
    } catch (err) {
      addLog('ERR', err.message, 'error');
    }
  }, [url, addLog, setClientState]);

  const handleDisconnect = useCallback(() => {
    if (clientRef.current) {
      clientRef.current.disconnect();
      clientRef.current = null;
      setClientState(STATE.OFFLINE);
      addLog('WS', 'Disconnected', 'warn');
    }
  }, [addLog, setClientState]);

  const handleRegister = useCallback(async () => {
    try {
      const reg = await clientRef.current.register(name);
      addLog('REG', `Registered as ${reg.agent_id}`, 'success');
    } catch (err) {
      addLog('ERR', err.message, 'error');
    }
  }, [name, addLog]);

  const handleSubscribe = useCallback(async () => {
    try {
      await clientRef.current.subscribe(phaseGroup);
      addLog('SUB', `Subscribed to "${phaseGroup}"`, 'info');
    } catch (err) {
      addLog('ERR', err.message, 'error');
    }
  }, [phaseGroup, addLog]);

  const handleCue = useCallback(async () => {
    try {
      await clientRef.current.cue(targetId, offsetBeats, phaseGroup, { note: 'from react-demo' });
      addLog('CUE', `Sent cue → ${targetId} (offset: ${offsetBeats})`, 'warn');
    } catch (err) {
      addLog('ERR', err.message, 'error');
    }
  }, [targetId, offsetBeats, phaseGroup, addLog]);

  const handleFire = useCallback(async () => {
    try {
      await clientRef.current.fire();
      addLog('FIRE', '🔥 Fired!', 'success');
    } catch (err) {
      addLog('ERR', err.message, 'error');
    }
  }, [addLog]);

  const handleReport = useCallback(async () => {
    try {
      await clientRef.current.report('ok', phaseGroup, 1);
      addLog('RPT', `Reported ok for "${phaseGroup}"`, 'success');
    } catch (err) {
      addLog('ERR', err.message, 'error');
    }
  }, [phaseGroup, addLog]);

  const connected = clientRef.current?.connected;
  const btnStyle = (enabled) => ({
    fontFamily: 'var(--font-mono)',
    fontSize: 12,
    padding: '8px 16px',
    borderRadius: 6,
    border: '1px solid',
    borderColor: enabled ? 'var(--accent)' : 'var(--border)',
    background: enabled ? 'var(--accent-dim)' : 'transparent',
    color: enabled ? 'var(--accent)' : 'var(--text-dim)',
    cursor: enabled ? 'pointer' : 'not-allowed',
    transition: 'all 0.2s',
    fontWeight: 600,
    letterSpacing: 0.5,
  });

  const inputStyle = {
    fontFamily: 'var(--font-mono)',
    fontSize: 12,
    padding: '8px 12px',
    borderRadius: 6,
    border: '1px solid var(--border)',
    background: 'var(--bg)',
    color: 'var(--text)',
    outline: 'none',
    width: '100%',
  };

  return (
    <div style={{
      background: 'var(--surface)',
      border: '1px solid var(--border)',
      borderRadius: 12,
      padding: 20,
    }}>
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-dim)', marginBottom: 16, textTransform: 'uppercase', letterSpacing: 2 }}>
        Controls
      </div>

      {/* Connection row */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 12, alignItems: 'center' }}>
        <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="ws://host:port" style={{ ...inputStyle, flex: 1 }} />
        {!connected ? (
          <button onClick={handleConnect} style={btnStyle(true)}>Connect</button>
        ) : (
          <button onClick={handleDisconnect} style={{ ...btnStyle(true), borderColor: 'var(--error)', color: 'var(--error)', background: '#ff386022' }}>Disconnect</button>
        )}
      </div>

      {/* Register */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 12, alignItems: 'center' }}>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Agent name" style={inputStyle} />
        <button onClick={handleRegister} style={btnStyle(connected && state !== STATE.OFFLINE)} disabled={!connected}>Register</button>
      </div>

      {/* Subscribe */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, alignItems: 'center' }}>
        <input value={phaseGroup} onChange={(e) => setPhaseGroup(e.target.value)} placeholder="Phase group" style={inputStyle} />
        <button onClick={handleSubscribe} style={btnStyle(connected)} disabled={!connected}>Subscribe</button>
      </div>

      {/* Divider */}
      <div style={{ borderTop: '1px solid var(--border)', margin: '16px 0' }} />

      {/* Cue */}
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-dim)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 2 }}>
        Send Cue
      </div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 12, alignItems: 'center' }}>
        <input value={targetId} onChange={(e) => setTargetId(e.target.value)} placeholder="Target agent ID" style={inputStyle} />
        <input type="number" value={offsetBeats} onChange={(e) => setOffsetBeats(Number(e.target.value))} style={{ ...inputStyle, width: 70 }} />
        <button onClick={handleCue} style={btnStyle(connected)} disabled={!connected}>⏱ Cue</button>
      </div>

      {/* Fire + Report */}
      <div style={{ display: 'flex', gap: 8 }}>
        <button
          onClick={handleFire}
          style={btnStyle(state === STATE.PRIMED)}
          disabled={state !== STATE.PRIMED}
        >
          🔥 Fire
        </button>
        <button
          onClick={handleReport}
          style={btnStyle(state === STATE.FIRING || state === STATE.COMPLETE)}
          disabled={state !== STATE.FIRING && state !== STATE.COMPLETE}
        >
          ✓ Report OK
        </button>
      </div>

      {/* Status bar */}
      <div style={{
        marginTop: 16,
        padding: '10px 14px',
        borderRadius: 8,
        background: 'var(--bg)',
        fontFamily: 'var(--font-mono)',
        fontSize: 11,
        display: 'flex',
        justifyContent: 'space-between',
        color: 'var(--text-dim)',
      }}>
        <span>id: <span style={{ color: agentId ? 'var(--accent)' : 'var(--text-dim)' }}>{agentId || '—'}</span></span>
        <span>state: <span style={{ color: STATE_COLORS[state] || 'var(--text)' }}>{state}</span></span>
        <span>groups: {phaseGroups.length > 0 ? phaseGroups.join(', ') : '—'}</span>
      </div>
    </div>
  );
}

// ── App ───────────────────────────────────────────────────────────────

export default function App() {
  const [clientState, setClientState] = useState(STATE.OFFLINE);
  const [agentId, setAgentId] = useState(null);
  const [phaseGroups, setPhaseGroups] = useState([]);
  const [events, setEvents] = useState([]);

  const addEvent = useCallback((evt) => {
    setEvents((prev) => [...prev.slice(-199), evt]);
  }, []);

  // Intercept agentId and phaseGroups from client events
  const wrappedAddEvent = useCallback((evt) => {
    addEvent(evt);
  }, [addEvent]);

  return (
    <div style={{
      maxWidth: 960,
      margin: '0 auto',
      padding: '32px 20px',
      display: 'flex',
      flexDirection: 'column',
      minHeight: '100vh',
      gap: 0,
    }}>
      {/* Header */}
      <div style={{ marginBottom: 24 }}>
        <h1 style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 20,
          fontWeight: 700,
          color: 'var(--accent)',
          letterSpacing: 1,
          marginBottom: 4,
        }}>
          ⏱ t-minus
        </h1>
        <p style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-dim)' }}>
          React demo — <code style={{ color: 'var(--info)' }}>@superinstance/tminus-client</code>
        </p>
      </div>

      {/* State machine */}
      <StateMachineVisualization currentState={clientState} />

      {/* Main layout */}
      <div style={{ display: 'flex', gap: 20, flex: 1, minHeight: 0 }}>
        {/* Controls */}
        <div style={{ width: 380, flexShrink: 0 }}>
          <ControlPanel
            client={null}
            state={clientState}
            agentId={agentId}
            addEvent={wrappedAddEvent}
            setClientState={setClientState}
            phaseGroups={phaseGroups}
          />
        </div>

        {/* Event log */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          <EventLog events={events} />
        </div>
      </div>
    </div>
  );
}
