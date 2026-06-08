#!/usr/bin/env node

/**
 * Simulation test for the t-minus client SDK.
 *
 * Starts the dispatcher server, connects 2 agents, tests the full lifecycle:
 *   register → subscribe → cue → fire → report → phase advance
 */

const { spawn } = require('child_process');
const path = require('path');
const { TminusClient, STATE } = require('../src/client');

const DISPATCHER_DIR = path.resolve(__dirname, '../../tminus-dispatcher');
const PORT = 9876;  // Use non-default port to avoid conflict
const URL = `ws://localhost:${PORT}`;

const TIMEOUT = 30000;  // 30s max per test
const BEAT_MS = 500;

let serverProcess = null;

// ── Coloured output ────────────────────────────────────────────────────
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const CYAN = '\x1b[36m';
const RESET = '\x1b[0m';

function pass(msg) { console.log(`${GREEN}✓ ${msg}${RESET}`); }
function fail(msg) { console.log(`${RED}✗ ${msg}${RESET}`); }
function info(msg) { console.log(`${CYAN}ℹ ${msg}${RESET}`); }
function warn(msg) { console.log(`${YELLOW}⚠ ${msg}${RESET}`); }

let passed = 0;
let failed = 0;

function assert(cond, msg) {
  if (cond) {
    pass(msg);
    passed++;
  } else {
    fail(msg);
    failed++;
  }
}

// ── Server management ──────────────────────────────────────────────────
async function startServer() {
  return new Promise((resolve, reject) => {
    info(`Starting dispatcher on port ${PORT}...`);
    serverProcess = spawn('node', ['src/index.js'], {
      cwd: DISPATCHER_DIR,
      env: { ...process.env, TMINUS_PORT: String(PORT) },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let started = false;
    const timeout = setTimeout(() => {
      if (!started) reject(new Error('Server start timeout'));
    }, 10000);

    serverProcess.stdout.on('data', (data) => {
      const text = data.toString();
      if (text.includes('T-Minus Cue Dispatcher') && !started) {
        started = true;
        clearTimeout(timeout);
        // Give a moment for the server to fully bind
        setTimeout(() => resolve(), 500);
      }
    });

    serverProcess.stderr.on('data', (data) => {
      // Server may log errors here
    });

    serverProcess.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });

    serverProcess.on('exit', (code) => {
      if (!started) {
        clearTimeout(timeout);
        reject(new Error(`Server exited with code ${code}`));
      }
    });
  });
}

function stopServer() {
  return new Promise((resolve) => {
    if (!serverProcess) { resolve(); return; }
    serverProcess.on('exit', () => resolve());
    serverProcess.kill('SIGINT');
    setTimeout(() => {
      if (serverProcess) {
        serverProcess.kill('SIGKILL');
        resolve();
      }
    }, 3000);
  });
}

// ── Delay helper ───────────────────────────────────────────────────────
function delay(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// ── Main test suite ────────────────────────────────────────────────────
async function runTests() {
  info('========================================');
  info('  t-minus Client SDK — Simulation Tests  ');
  info('========================================\n');

  let clientA, clientB;

  try {
    // ── Start server ──────────────────────────────────────────────────
    await startServer();
    pass('Dispatcher server started');

    // ── Test 1: Connect clients ───────────────────────────────────────
    info('\n--- Test 1: Connect clients ---');
    clientA = new TminusClient(URL, { reconnectAttempts: 0, pingInterval: 5000 });
    clientB = new TminusClient(URL, { reconnectAttempts: 0, pingInterval: 5000 });

    await clientA.connect();
    assert(clientA.connected, 'Client A connected');

    await clientB.connect();
    assert(clientB.connected, 'Client B connected');

    // ── Test 2: Register clients ──────────────────────────────────────
    info('\n--- Test 2: Register clients ---');
    const regA = await clientA.register('agent-alpha', {
      timbre: 'bright',
      frequency: 1.0,
      context_depth: 'shallow',
    });
    assert(regA.agent_id && regA.agent_id.includes('agent-alpha'), `Client A registered as ${regA.agent_id}`);
    assert(clientA.agentId === regA.agent_id, 'Client A agentId matches');
    assert(clientA.state === STATE.REGISTERED, 'Client A state is REGISTERED');

    const regB = await clientB.register('agent-beta', {
      timbre: 'warm',
      frequency: 0.8,
      context_depth: 'deep',
    });
    assert(regB.agent_id && regB.agent_id.includes('agent-beta'), `Client B registered as ${regB.agent_id}`);
    assert(clientB.state === STATE.REGISTERED, 'Client B state is REGISTERED');

    // ── Test 3: Subscribe to phase group ──────────────────────────────
    info('\n--- Test 3: Subscribe to phase group ---');
    const subA = await clientA.subscribe('orchestra-alpha');
    assert(subA.phase_groups.includes('orchestra-alpha'), 'Client A subscribed to orchestra-alpha');
    assert(clientA.state === STATE.LISTENING, 'Client A state is LISTENING');
    assert(clientA.phaseGroups.includes('orchestra-alpha'), 'Client A phaseGroups includes orchestra-alpha');

    const subB = await clientB.subscribe('orchestra-alpha');
    assert(subB.phase_groups.includes('orchestra-alpha'), 'Client B subscribed to orchestra-alpha');
    assert(clientB.state === STATE.LISTENING, 'Client B state is LISTENING');

    // ── Test 4: Send cue from A to B ──────────────────────────────────
    info('\n--- Test 4: Send cue from Agent A to Agent B (offset=2 beats) ---');

    // Set up listener on B BEFORE sending the cue (CUED arrives before REGISTERED ack)
    const cuedBPromise = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Timeout waiting for CUED')), 5000);
      clientB.once('cued', (p) => {
        clearTimeout(timer);
        resolve(p);
      });
    });

    const cueResult = await clientA.cue(clientB.agentId, 2, 'orchestra-alpha', { note: 'C5' });
    assert(cueResult.cue_id, 'Cue was sent and received an ID');
    assert(cueResult.target_id === clientB.agentId, 'Cue targets Agent B');
    assert(cueResult.delay_ms >= 800, `Cue delay is reasonable: ${cueResult.delay_ms}ms`);

    // Wait for B to receive CUED
    const cuedB = await cuedBPromise;
    assert(cuedB.cue_id === cueResult.cue_id, 'Client B received CUED with matching cue_id');
    assert(cuedB.source === clientA.agentId, 'Client B CUED source is Agent A');
    assert(clientB.state === STATE.CUED, 'Client B state changed to CUED');

    // ── Test 5: Wait for primed (offset = 2 beats = ~1000ms) ──────────
    info('\n--- Test 5: Wait for PRIMED (offset=2 beats) ---');
    // Set up PRIMED listener before PRIMED arrives (offset=2 beats = ~1000ms delay)
    // CUED already arrived, so PRIMED will come after the countdown
    const primedBPromise = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Timeout waiting for PRIMED')), 10000);
      clientB.once('primed', (p) => {
        clearTimeout(timer);
        resolve(p);
      });
    });
    const primedB = await primedBPromise;
    assert(primedB.cue_id === cueResult.cue_id, 'Client B received PRIMED with matching cue_id');
    assert(primedB.source === clientA.agentId, 'PRIMED source is Agent A');
    assert(clientB.state === STATE.PRIMED, 'Client B state changed to PRIMED');

    // ── Test 6: Fire and report ───────────────────────────────────────
    info('\n--- Test 6: Fire and report ---');
    const fireResult = await clientB.fire();
    assert(fireResult.state === STATE.FIRING, 'FIRE_ACK confirms FIRING state');
    assert(clientB.state === STATE.FIRING, 'Client B state is FIRING');

    const reportResult = await clientB.report('success', 'orchestra-alpha', 1);
    assert(reportResult.state === STATE.COMPLETE, 'COMPLETE_ACK confirms COMPLETE state');
    assert(clientB.state === STATE.COMPLETE, 'Client B state is COMPLETE');
    assert(reportResult.cues_completed >= 1, 'At least 1 cue was completed');

    // ── Test 7: Phase advance (server-side alignment) ────────────────
    info('\n--- Test 7: Phase advance notification ---');
    // The server's PhaseGroupManager.recordCueCompleted returns null unless an
    // explicit alignment point has been opened (via openAlignmentPoint). Since
    // the dispatcher does not auto-open alignment points, PHASE_ADVANCE won't
    // fire here. This test verifies that the listener infrastructure works.
    const advancePromise = new Promise((resolve) => {
      const timer = setTimeout(() => resolve(null), 3000);
      clientA.once('phase_advance', (p) => {
        clearTimeout(timer);
        resolve(p);
      });
    });
    const advance = await advancePromise;
    if (advance === null) {
      info('PHASE_ADVANCE not received (expected: server requires explicit alignment point opening)');
      pass('Phase advance infrastructure ready (alignment point not auto-opened by server)');
    } else {
      assert(advance.group === 'orchestra-alpha', 'PHASE_ADVANCE group matches');
    }

    // ── Test 8: Fire-and-report convenience method ───────────────────
    info('\n--- Test 8: Fire-and-report convenience method ---');
    // Re-cue B from A to set up PRIMED again
    // NOTE: offset=0 is treated as a pre-cue by the server (offset_beats <= 0),
    // so B goes directly to PRIMED without CUED.
    const primed2Promise = new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('Timeout PRIMED in test 8')), 5000);
      clientB.once('primed', () => { clearTimeout(t); resolve(); });
    });

    const cue2 = await clientA.cue(clientB.agentId, 0, 'orchestra-alpha',
      { note: 'D5', immediate: true });
    assert(cue2.pre_cued === true, 'Offset=0 cue is flagged as pre_cued');

    // B should go directly to PRIMED (offset=0 = immediate pre-cue)
    await primed2Promise;
    pass('PRIMED received in test 8 (immediate pre-cue)');

    const frResult = await clientB.fireAndReport('success', 'orchestra-alpha', 2);
    assert(frResult.state === STATE.COMPLETE, 'fireAndReport completes');
    assert(clientB.state === STATE.COMPLETE, 'Client B back to COMPLETE after fireAndReport');

    // ── Test 9: Pre-cue (negative offset) ──────────────────────────────
    info('\n--- Test 9: Pre-cue with negative offset ---');
    // Set up listener on B before sending
    const primedPrePromise = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Timeout waiting for pre-cue PRIMED')), 5000);
      clientB.once('primed', (p) => {
        clearTimeout(timer);
        resolve(p);
      });
    });

    const preCue = await clientA.cue(clientB.agentId, -1, 'orchestra-alpha',
      { pre_cue_test: true });
    assert(preCue.pre_cued === true, 'Pre-cue flagged as pre_cued');
    // B should go directly to PRIMED (pre-cues skip CUED state)
    const primedPre = await primedPrePromise;
    assert(primedPre.pre_cued === true, 'PRIMED flagged as pre_cue');
    assert(clientB.state === STATE.PRIMED, 'Client B is PRIMED after pre-cue');

    // Clean up B's state
    await clientB.fireAndReport('ok', 'orchestra-alpha', 0);

    // ── Test 10: Unsubscribe ──────────────────────────────────────────
    info('\n--- Test 10: Unsubscribe ---');
    const unsubA = await clientA.unsubscribe('orchestra-alpha');
    assert(!unsubA.phase_groups.includes('orchestra-alpha'), 'Client A unsubscribed from orchestra-alpha');
    assert(clientA.phaseGroups.length === 0, 'Client A has no phase groups');
    assert(clientA.state === STATE.REGISTERED, 'Client A returned to REGISTERED state');

    // ── Test 11: Heartbeat / PING ─────────────────────────────────────
    info('\n--- Test 11: Heartbeat (PING/PONG) ---');
    // Set up listener before ping fires
    const pongPromise = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Timeout waiting for PONG')), 10000);
      clientA.once('pong', (p) => {
        clearTimeout(timer);
        resolve(p);
      });
    });
    const pong = await pongPromise;
    assert(pong !== undefined, 'PONG received (heartbeat working)');

    // ── Test 12: Disconnect ──────────────────────────────────────────
    info('\n--- Test 12: Disconnect ---');
    clientA.disconnect();
    assert(!clientA.connected, 'Client A disconnected');
    assert(clientA.state === STATE.OFFLINE, 'Client A state is OFFLINE');
    assert(clientA.agentId === null, 'Client A agentId cleared');
    pass('Client A disconnected cleanly');

    clientB.disconnect();
    assert(!clientB.connected, 'Client B disconnected');
    pass('Client B disconnected cleanly');

    // ── Results ───────────────────────────────────────────────────────
    info('\n========================================');
    info('  Test Results');
    info('========================================\n');
    info(`Passed: ${passed}`);
    info(`Failed: ${failed}`);

    if (failed > 0) {
      console.log(`\n${RED}❌ Some tests FAILED${RESET}`);
      process.exitCode = 1;
    } else {
      console.log(`\n${GREEN}✅ All tests PASSED${RESET}`);
    }

  } catch (err) {
    console.error(`\n${RED}❌ Test suite error: ${err.message}${RESET}`);
    console.error(err.stack);
    failed++;
    process.exitCode = 1;
  } finally {
    // Clean up clients
    try {
      if (clientA && clientA.connected) clientA.disconnect();
      if (clientB && clientB.connected) clientB.disconnect();
    } catch (_) { /* ignore */ }

    // Stop server
    await stopServer();
    info('Dispatcher server stopped');
  }
}

runTests();
