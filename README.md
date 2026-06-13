# T-Minus Client

Node.js client SDK and CLI for the **t-minus cue dispatcher** — a multi-agent orchestration protocol for coordinating synchronized actions across distributed AI agent fleets. Provides WebSocket connectivity with auto-reconnect, a full agent lifecycle state machine, phase-group management, and a promisified API.

## Why It Matters

Orchestrating a fleet of AI agents — each running on different hardware, with different latencies and capabilities — requires precise timing coordination. You can't just send a "go" message and hope they all start simultaneously. Network jitter alone can introduce 10-100ms of variance.

**T-Minus** solves this with a **cue-primed-fire** protocol:

1. **Cue**: The dispatcher tells agents "prepare for action X at time T"
2. **Prime**: Agents acknowledge readiness ("I'm ready to fire")
3. **Fire**: The dispatcher sends the fire signal — all agents execute simultaneously

This is the same pattern used in aerospace launch sequences (hence "T-Minus"), military operations, and distributed database commit protocols (two-phase commit).

### Key Features

- **WebSocket transport** with exponential backoff reconnection (up to 3 attempts)
- **Full state machine**: `offline → registered → listening → cued → primed → firing → complete`
- **Phase groups**: agents can join/leave named groups for coordinated multi-phase operations
- **Heartbeat**: 10-second ping interval for connection health
- **Promisified API**: every action returns a Promise that resolves on server ACK
- **EventEmitter**: emits state transitions, phase advances, and errors

## How It Works

### Agent Lifecycle State Machine

```
                    ┌──────────┐
                    │ OFFLINE  │
                    └────┬─────┘
                         │ register()
                         ▼
                    ┌──────────┐
                    │REGISTERED│
                    └────┬─────┘
                         │ subscribe()
                         ▼
              ┌──────────────────┐
         ┌───▶│    LISTENING     │◀───┐
         │    └────┬─────┬───────┘    │
         │         │     │            │
         │   cue() │     │ cue()      │
         │         ▼     ▼            │
         │    ┌──────┐ ┌──────┐      │
         │    │ CUED │ │PRIMED│      │
         │    └──┬───┘ └──┬───┘      │
         │       │        │           │
         │  fire()│   fire()│         │
         │       ▼        ▼           │
         │    ┌────────────────┐      │
         │    │    FIRING      │      │
         │    └───────┬────────┘      │
         │            │ complete()    │
         │            ▼               │
         │    ┌────────────────┐      │
         └────│   COMPLETE     │──────┘
              └────────────────┘
```

Each transition validates against an allowed-transition table, ensuring agents never enter illegal states.

### Message Protocol

Client → Server messages:

| Message | Payload | Purpose |
|---|---|---|
| `REGISTER` | `{agentId}` | Announce this agent |
| `SUBSCRIBE` | `{groups: [...]}` | Join phase groups |
| `CUE` | `{target, offset, group, payload}` | Schedule a timed action |
| `FIRE` | `{cueId}` | Execute the cued action |
| `REPORT` | `{result, group}` | Report completion status |
| `PING` | — | Heartbeat |

Server → Client messages:

| Message | Purpose |
|---|---|
| `REGISTERED` | Registration confirmed |
| `CUED` | A cue has been scheduled for this agent |
| `PRIMED` | The system is primed and ready |
| `FIRE_ACK` | Fire command acknowledged |
| `COMPLETE_ACK` | Completion acknowledged |
| `PHASE_ADVANCE` | Phase group advanced |
| `ERROR` | Error notification |

### Reconnection with Exponential Backoff

```
attempt 1: wait 1000ms → connect
attempt 2: wait 2000ms → connect
attempt 3: wait 4000ms → connect
(if all fail, emit 'disconnect')
```

Backoff formula: $\text{delay}_k = \text{delay}_0 \times 2^{k-1}$, capped at 3 attempts.

### Heartbeat Protocol

Every `pingInterval` ms (default 10s), the client sends a `PING`. If no `PONG` is received within the next interval, the connection is considered stale and reconnection begins.

### Message Correlation

Each outgoing message includes a sequence number `seq`. The pending-promises map tracks `{seq → {resolve, reject}}`. When a matching ACK arrives, the promise resolves:

$$\text{pending}[seq].\text{resolve}(\text{ack\_payload})$$

This ensures every action gets a definitive result — no fire-and-forget ambiguity.

## Quick Start

### As a Library

```javascript
const { TminusClient } = require('@superinstance/tminus-client');

const client = new TminusClient('ws://dispatcher:8765');

client.on('state', (newState) => {
  console.log(`State: ${newState}`);
});

await client.connect();
await client.register('agent-alpha');
await client.subscribe(['render-phase', 'inference-phase']);

// Cue an action
await client.cue('render-frame', 0, 'render-phase', { frameId: 42 });

// Wait for PRIMED, then fire
client.on('primed', async () => {
  await client.fire();
  await client.report('success', 'render-phase');
});
```

### As a CLI

```bash
# Install globally
npm install -g @superinstance/tminus-client

# Connect and register
tminus-cli --port 8765 --name agent-alpha

# Interactive commands
/register agent-alpha
/subscribe render-phase inference-phase
/cue render-frame 0 render-phase
/fire
/report success render-phase
/status
/quit
```

## API

### `TminusClient extends EventEmitter`

| Method | Returns | Description |
|---|---|---|
| `constructor(url, opts)` | — | Create client (opts: `reconnectAttempts`, `reconnectDelay`, `pingInterval`) |
| `connect()` | `Promise<void>` | Establish WebSocket connection |
| `disconnect()` | `void` | Cleanly close connection |
| `register(agentId)` | `Promise` | Register agent identity |
| `subscribe(...groups)` | `Promise` | Join phase groups |
| `unsubscribe(group)` | `Promise` | Leave a phase group |
| `cue(target, offset, group, payload?)` | `Promise` | Schedule a timed action |
| `fire()` | `Promise` | Execute current cue |
| `report(result, group)` | `Promise` | Report completion |
| `ping()` | `Promise` | Manual heartbeat |

### Properties
- `agentId: string | null` — current agent identity
- `state: string` — lifecycle state
- `phaseGroups: string[]` — subscribed groups

### Events
- `state(newState)` — lifecycle transition
- `cued(cueData)` — received a cue
- `primed()` — system primed
- `phaseAdvance(group, phase)` — phase group advanced
- `error(message)` — protocol error
- `disconnect()` — connection lost

## Architecture Notes

Within the **γ + η = C** framework:

- **γ (gamma)** — the agent's intentions: REGISTER, CUE, FIRE — the *signal* expressing what this agent wants to do
- **η (eta)** — the dispatcher's responses: REGISTERED, CUED, FIRE_ACK — the *environment response* coordinating multiple agents
- **C** — **coordinated execution**: when γ and η are synchronized across all agents, the fleet fires in unison — the distributed systems ideal

The client depends only on `ws` (WebSocket) — no other runtime dependencies. Works on Node.js ≥ 18.

## References

1. Gray, J. (1978). "Notes on Data Base Operating Systems." *Operating Systems: An Advanced Course*, Springer. — Two-phase commit protocol.
2. Lamport, L. (1978). "Time, Clocks, and the Ordering of Events in a Distributed System." *CACM*, 21(7), 558-565. — Distributed timing fundamentals.
3. RFC 6455. (2011). *The WebSocket Protocol*. Fette & Melnikov. — WebSocket transport specification.
4. Marz, N., & Warren, J. (2015). *Big Data*. Manning. — Lambda architecture and coordinated batch/speed layers.

## License

MIT
