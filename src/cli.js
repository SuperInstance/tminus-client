#!/usr/bin/env node

/**
 * tminus-cli — Interactive CLI for the t-minus cue dispatcher.
 *
 * Usage:
 *   node src/cli.js --port 8765 --name agent-alpha
 *   node src/cli.js --url ws://myhost:8765
 *
 * Commands (interactive):
 *   /register <name>          Register this agent
 *   /subscribe <group> [...]  Subscribe to phase groups
 *   /unsubscribe <group>      Unsubscribe from a phase group
 *   /cue <target> <offset> <group> [payload]
 *                              Send a t-minus cue
 *   /cue-await <target> <offset> <group> [payload]
 *                              Send cue then wait for a PRIMED
 *   /fire                     Fire the current cue
 *   /report <result> <group>  Report completion
 *   /firereport <result> <group>
 *                              Fire and report in one step
 *   /status                   Show connection + state info
 *   /ping                     Send heartbeat ping
 *   /help                     Show this help
 *   /quit                     Disconnect and exit
 *   > <any>                    Send raw JSON
 */

const { TminusClient, STATE } = require('./client');
const readline = require('readline');

// ── Parse args ─────────────────────────────────────────────────────────
let url = 'ws://localhost:8765';
let agentName = null;
let autoSubscribe = null;

for (let i = 2; i < process.argv.length; i++) {
  const arg = process.argv[i];
  if (arg === '--url' || arg === '-u') url = `ws://${process.argv[++i]}`;
  else if (arg === '--port' || arg === '-p') {
    const port = process.argv[++i];
    url = `ws://localhost:${port}`;
  } else if (arg === '--name' || arg === '-n') {
    agentName = process.argv[++i];
  } else if (arg === '--subscribe' || arg === '-s') {
    autoSubscribe = process.argv[++i];
  } else if (arg === '--help' || arg === '-h') {
    showHelp();
    process.exit(0);
  }
}

function showHelp() {
  console.log(`
  tminus-cli — interactive t-minus dispatcher client

  Usage:
    node src/cli.js [options]

  Options:
    --port <N>       Server port (default: 8765)
    --url <host>     Full WebSocket URL
    --name <name>    Auto-register with this name on connect
    --subscribe <g>  Auto-subscribe to phase group
    --help           Show this help

  Interactive Commands:
    /register <name>          Register this agent
    /subscribe <g> [...]      Subscribe to phase groups
    /unsubscribe <g>          Unsubscribe from a phase group
    /cue <target> <offset> <group> [payload]
                              Send a t-minus cue
    /cue-await <target> <offset> <group> [payload]
                              Send cue then wait for PRIMED
    /fire                     Fire the current cue
    /report <r> <g>           Report completion
    /firereport <r> <g>       Fire and report in one step
    /status                   Show connection + state info
    /ping                     Send heartbeat ping
    /help                     Show this help
    /quit                     Disconnect and exit
`);
}

// ── Client setup ──────────────────────────────────────────────────────
const client = new TminusClient(url, {
  reconnectAttempts: 0,    // Manual control in CLI
});

// ── Event display ────────────────────────────────────────────────────
client.on('connected', () => {
  console.log('\n✓ Connected to', url);
  printStatus();
});

client.on('disconnected', () => {
  console.log('\n✗ Disconnected from', url);
});

client.on('registered', (p) => {
  console.log(`\n✓ Registered as "${p.agent_id}" [state: ${p.state}]`);
});

client.on('subscribed', (p) => {
  console.log(`\n✓ Subscribed to groups: ${(p.phase_groups || []).join(', ')}`);
});

client.on('cued', (p) => {
  const prefix = p.pre_cued ? '⚡ PRE-CUED' : '🔔 CUED';
  console.log(`\n${prefix}: ${p.cue_id} from ${p.source} (offset=${p.offset_beats}, group=${p.phase_group})`);
  if (p.payload) console.log('  Payload:', JSON.stringify(p.payload, null, 2));
});

client.on('primed', (p) => {
  const pre = p.pre_cued ? ' (pre-cued)' : '';
  console.log(`\n🚀 PRIMED: ${p.cue_id} from ${p.source}${pre}`);
  console.log('  Use /fire to execute');
});

client.on('fire_ack', (p) => {
  console.log(`\n🔥 FIRE_ACK: state=${p.state}`);
  console.log('  Use /report <result> <group> to complete');
});

client.on('complete', (p) => {
  console.log(`\n✅ COMPLETE: ${p.cues_completed} cue(s) done, state=${p.state}`);
});

client.on('phase_advance', (p) => {
  console.log(`\n▶ PHASE ADVANCE: group=${p.group} → point=${p.point}`);
});

client.on('server_error', (p) => {
  console.log(`\n⚠ Server error: [${p.code}] ${p.message}`);
});

client.on('error', (err) => {
  console.log(`\n⚠ Client error: ${err.message}`);
});

client.on('state_change', ({ from, to }) => {
  console.log(`  State: ${from} → ${to}`);
});

client.on('reconnect_failed', () => {
  console.log('\n✗ Reconnect failed. Use /connect to retry.');
});

function printStatus() {
  console.log(`  URL:    ${url}`);
  console.log(`  Agent:  ${client.agentId || '(not registered)'}`);
  console.log(`  State:  ${client.state}`);
  console.log(`  Groups: ${client.phaseGroups.length ? client.phaseGroups.join(', ') : '(none)'}`);
}

// ── CLI readline ─────────────────────────────────────────────────────
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  prompt: 'tminus> ',
});

console.log('\n╔══════════════════════════════════════╗');
console.log('║   t-minus CLI Client v1.0.0          ║');
console.log('║   Type /help for commands             ║');
console.log('╚══════════════════════════════════════╝\n');

// Auto-connect
client.connect().catch((err) => {
  console.log(`\n⚠ Connection failed: ${err.message}. Use /connect to retry.`);
});

// Auto-register if name provided
if (agentName) {
  client.once('connected', () => {
    client.register(agentName).then(() => {
      if (autoSubscribe) {
        return client.subscribe(autoSubscribe.split(',').map(s => s.trim()));
      }
    }).catch((err) => {
      console.log(`\n⚠ Auto-register failed: ${err.message}`);
    });
  });
}

rl.prompt();

rl.on('line', async (line) => {
  const trimmed = line.trim();
  if (!trimmed) { rl.prompt(); return; }

  try {
    await handleCommand(trimmed);
  } catch (err) {
    console.log(`\n⚠ Error: ${err.message}`);
  }

  rl.prompt();
});

rl.on('close', () => {
  client.disconnect();
  console.log('\nGoodbye.');
  process.exit(0);
});

// ── Command handler ────────────────────────────────────────────────────
async function handleCommand(line) {
  const parts = line.split(/\s+/);
  const cmd = parts[0].toLowerCase();

  switch (cmd) {
    case '/connect': {
      await client.connect();
      break;
    }
    case '/disconnect': {
      client.disconnect();
      break;
    }
    case '/register': {
      if (!parts[1]) { console.log('Usage: /register <name>'); return; }
      const name = parts.slice(1).join(' ');
      await client.register(name);
      break;
    }
    case '/subscribe': {
      if (parts.length < 2) { console.log('Usage: /subscribe <group> [...]'); return; }
      const groups = parts.slice(1);
      await client.subscribe(groups);
      break;
    }
    case '/unsubscribe': {
      if (parts.length < 2) { console.log('Usage: /unsubscribe <group>'); return; }
      await client.unsubscribe(parts[1]);
      break;
    }
    case '/cue': {
      if (parts.length < 4) {
        console.log('Usage: /cue <target> <offset> <group> [payloadJSON]');
        return;
      }
      const target = parts[1];
      const offset = parseInt(parts[2], 10);
      const group = parts[3];
      let payload = null;
      if (parts[4]) {
        try { payload = JSON.parse(parts.slice(4).join(' ')); }
        catch (_) { payload = parts.slice(4).join(' '); }
      }
      const result = await client.cue(target, offset, group, payload);
      console.log(`\n✓ Cue sent: ${result.cue_id} (pre_cued: ${result.pre_cued}, delay: ${result.delay_ms}ms)`);
      break;
    }
    case '/cue-await': {
      if (parts.length < 4) {
        console.log('Usage: /cue-await <target> <offset> <group> [payloadJSON]');
        return;
      }
      const target = parts[1];
      const offset = parseInt(parts[2], 10);
      const group = parts[3];
      let payload = null;
      if (parts[4]) {
        try { payload = JSON.parse(parts.slice(4).join(' ')); }
        catch (_) { payload = parts.slice(4).join(' '); }
      }
      const result = await client.cue(target, offset, group, payload);
      console.log(`\n✓ Cue sent: ${result.cue_id} (delay: ${result.delay_ms}ms). Waiting for PRIMED...`);
      const primed = await client.awaitCue(60000);
      console.log(`\n🚀 PRIMED received from ${primed.source}! (cue_id: ${primed.cue_id})`);
      break;
    }
    case '/fire': {
      await client.fire();
      // fire_ack is emitted via event handler
      break;
    }
    case '/report': {
      if (parts.length < 3) {
        console.log('Usage: /report <result> <group> [durationBeats]');
        return;
      }
      const result = parts[1];
      const group = parts[2];
      const dur = parseInt(parts[3], 10) || 0;
      await client.report(result, group, dur);
      break;
    }
    case '/firereport': {
      if (parts.length < 3) {
        console.log('Usage: /firereport <result> <group> [durationBeats]');
        return;
      }
      const result = parts[1];
      const group = parts[2];
      const dur = parseInt(parts[3], 10) || 0;
      await client.fireAndReport(result, group, dur);
      break;
    }
    case '/status': {
      printStatus();
      break;
    }
    case '/ping': {
      // Ping is sent automatically, but manual is fine
      console.log('  Ping sent (heartbeat runs automatically)');
      break;
    }
    case '/help': {
      showHelp();
      break;
    }
    case '/quit':
    case '/exit': {
      client.disconnect();
      rl.close();
      break;
    }
    default: {
      // Try to send as raw JSON
      if (line.startsWith('{')) {
        try {
          const msg = JSON.parse(line);
          if (client.connected) {
            client._sendRaw(msg);
            console.log('  Sent raw message');
          } else {
            console.log('  Not connected');
          }
        } catch (_) {
          console.log(`  Unknown command: ${cmd}`);
        }
      } else {
        console.log(`  Unknown command: ${cmd}. Type /help`);
      }
    }
  }
}
