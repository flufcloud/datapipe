# DataPipe Implementation Roadmap

This roadmap translates the design document into concrete, testable engineering phases.

## Monorepo Layout

```text
datapipe/
  apps/
    orchestrator/      # Elixir/Phoenix
    execution-engine/  # Node.js service
    web/               # Frontend SPA
  docs/
```

## Cross-Cutting Standards

- Every packet has: `packet_id`, `project_id`, `node_id`, `timestamp`, `payload`, `schema`.
- Every websocket event has: `event`, `request_id`, `project_id`, `payload`.
- DAG writes are validated server-side before commit.
- Node execution errors are non-fatal to graph lifecycle; isolate and report.
- All external integrations are implemented in `execution-engine` only.

---

## Phase 1: Orchestrator + Visual Canvas Baseline

### Goal

Enable users to create nodes and edges on a visual canvas and persist a valid DAG using Phoenix Channels.

### Deliverables

- Phoenix app bootstrapped with:
  - channel endpoint for project sessions
  - GenServer per active project/session
  - DAG store with in-memory cache + PostgreSQL persistence
- Frontend SPA with:
  - draggable/zoomable canvas
  - node create/delete/move
  - edge connect/disconnect
  - real-time sync through websocket
- Validation:
  - prevent cycles
  - validate port compatibility
  - reject malformed IDs/types

### Suggested Work Breakdown

1. Define DB schema (`projects`, `nodes`, `edges`)
2. Implement `GraphState` GenServer
3. Add channel events:
   - `graph:init`
   - `node:create`
   - `node:update_position`
   - `node:delete`
   - `edge:create`
   - `edge:delete`
4. Add DAG validator module:
   - acyclic check
   - port type compatibility
5. Implement minimal frontend canvas with event handlers
6. Add integration tests for channel event flows

### Exit Criteria

- Two clients connected to same project see consistent node/edge updates.
- Server rejects invalid/cyclic edge creation.
- Graph persists and reloads after orchestrator restart.

---

## Phase 2: Web Bluetooth Input Streaming

### Goal

Stream live sensor data from browser-connected devices into orchestrator data channels.

### Deliverables

- Frontend Bluetooth adapter node
- Permission/connect/disconnect UX
- Packetized sensor stream to backend over websocket
- Rate limiting and payload schema validation in orchestrator
- Basic live visualization (sparkline/vector view)

### Suggested Work Breakdown

1. Add `Generator.Bluetooth` node type metadata and config schema
2. Implement browser-side Bluetooth service abstraction
3. Emit packet stream from frontend to `packet:ingest` channel event
4. Validate packet schema and broadcast to downstream nodes
5. Add backpressure handling (drop/coalesce strategy)
6. Add reconnect and stale session handling

### Exit Criteria

- Live accelerometer-like vectors appear on canvas node monitor.
- Stream continues during node drag/edit operations.
- Invalid packets are rejected with user-visible errors.

---

## Phase 3: ML Worker + Record/Train/Infer Lifecycle

### Goal

Integrate Node.js execution engine for time-series classifier training and inference.

### Deliverables

- Node.js worker service with gRPC or HTTP API
- Classifier node lifecycle state machine:
  - `idle`
  - `recording`
  - `training`
  - `inferencing`
  - `error`
- Temporal buffer for labeled examples
- Training job dispatch + status events
- Inference output labels routed into graph

### Suggested Work Breakdown

1. Define orchestrator <-> execution engine API contract
2. Implement `Classifier` node state transitions in orchestrator
3. Add recording buffers and dataset labeling
4. Implement training endpoint and model artifact storage
5. Add inference endpoint and low-latency prediction path
6. Add retry/failure reporting and metrics

### Exit Criteria

- User records labeled gesture samples and trains a model.
- Inference emits labels in near real-time to downstream nodes.
- Training failures do not crash project session.

---

## Phase 4: Consumer Integrations (Spotify First)

### Goal

Trigger external side effects from classified events.

### Deliverables

- OAuth flow via Node.js adapter
- Token refresh and credential storage
- Spotify consumer node with action mapping
- End-to-end event trigger path from input gesture to API call

### Suggested Work Breakdown

1. Implement integration credential vault abstraction
2. Add Spotify auth callback + refresh token support
3. Add `Consumer.Spotify` node config (action mapping)
4. Trigger playback command on matching label packets
5. Add retries and idempotency guard
6. Audit log for external actions

### Exit Criteria

- Gesture label triggers configured Spotify action reliably.
- Expired token refresh is automatic.
- Failed API actions are visible in node status and logs.

---

## Recommended Testing Strategy

- Unit tests:
  - DAG validation
  - port compatibility rules
  - classifier lifecycle transitions
- Integration tests:
  - channel event round-trips
  - orchestrator <-> execution engine API
  - Spotify trigger flow with mocked API
- Resilience tests:
  - worker crash/restart
  - websocket reconnect
  - high-frequency packet bursts
