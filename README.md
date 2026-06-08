# t-minus Client SDK

A standalone Node.js client SDK for the [t-minus cue dispatcher](https://github.com/openclaw/tminus-dispatcher).

```
npm install tminus-client
```

## Quick Start

```javascript
const { TminusClient } = require('tminus-client');

async function main() {
  const client = new TminusClient('ws://localhost:8765');
  await client.connect();

  // Register
  const reg = await client.register('my-agent', {
    timbre: 'bright',
    frequency: 1.0,
  });

  // Subscribe to a phase group
  await client.subscribe('group-alpha');

  // Send a cue to another agent (3 beat countdown)
  await client.cue('target-agent-id', 3, 'group-alpha', { task: 'play C5' });

  // Wait for your own cue
  client.on('cued', (payload) => {
    console.log(`Cued by ${payload.source}: ${payload.cue_id}`);
  });

  // When primed, fire and report
  client.on('primed', async (payload) => {
    await client.fire();
    await client.report('success', 'group-alpha', 1);
  });

  // Phase advance
  client.on('phase_advance', (payload) => {
    console.log(`Phase advanced: ${payload.group} → ${payload.point}`);
  });
}
```

## API

### `new TminusClient(url, opts)`

| Option              | Default   | Description                    |
|---------------------|-----------|--------------------------------|
| `reconnectAttempts` | `3`       | Max auto-reconnect attempts    |
| `reconnectDelay`    | `1000`    | Initial reconnect backoff (ms) |
| `pingInterval`      | `10000`   | Heartbeat interval (ms)        |

### Connection

- `connect()` — Open WebSocket (returns Promise)
- `disconnect()` — Clean close

### Agent Lifecycle

| Method                                 | Description                         |
|----------------------------------------|-------------------------------------|
| `register(name, opts)`                 | Register with the dispatcher        |
| `subscribe(groups)`                    | Join phase group(s)                 |
| `unsubscribe(groups)`                  | Leave phase group(s)                |
| `cue(targetId, offset, group, payload)`| Send a t-minus cue                  |
| `fire()`                               | Execute the primed cue              |
| `report(result, group, durationBeats)` | Report completion                   |
| `fireAndReport(result, group, dur)`    | Convenience: fire + report          |
| `awaitCue(timeoutMs)`                  | Promise that resolves on next CUED  |

### Events

| Event               | Payload                          |
|---------------------|----------------------------------|
| `connected`         | —                                |
| `disconnected`      | —                                |
| `registered`        | `{ agent_id, state }`            |
| `subscribed`        | `{ agent_id, phase_groups }`     |
| `cued`              | `{ cue_id, source, offset_beats, delay_ms, phase_group, payload }` |
| `primed`            | `{ cue_id, source, pre_cued, payload }` |
| `fire_ack`          | `{ state }`                      |
| `complete`          | `{ state, cues_completed }`      |
| `phase_advance`     | `{ group, point }`               |
| `state_change`      | `{ from, to }`                   |
| `server_error`      | `{ code, message }`              |
| `reconnect_failed`  | —                                |

## CLI

```
npx tminus-cli --port 8765 --name my-agent
```

Interactive commands: `/register`, `/subscribe`, `/cue`, `/fire`, `/report`, `/status`, `/quit`
