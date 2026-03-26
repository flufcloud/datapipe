# DataPipe Developer Guide

## Purpose

This document explains how DataPipe works internally: code structure, runtime logic, constraints, dependencies, persistence, and safe extension points.

## System Overview

DataPipe is a three-service local system.

- `apps/web` is the authoring and monitoring client.
- `apps/orchestrator` is the source of truth for graph state and runtime routing.
- `apps/execution-engine` is the worker boundary for ML and third-party integrations.

Core design rule:

- The orchestrator owns graph truth.
- The execution engine owns side-effecting integrations and model logic.
- The web app owns device access and user interaction.

## Service Responsibilities

### `apps/web`

Owns:

- canvas rendering
- local optimistic graph drafts
- websocket connection to Phoenix
- Bluetooth device access through Web Bluetooth
- demo sensor generation
- node inspector UX

Does not own:

- canonical graph state
- direct calls to Spotify
- model training or inference persistence

### `apps/orchestrator`

Owns:

- graph CRUD
- server-side DAG validation
- packet validation
- packet routing
- graph persistence
- classifier lifecycle state transitions
- fusion node state tracking
- consumer runtime state persistence

Does not own:

- ML model training implementation
- external OAuth or token handling
- browser device access

### `apps/execution-engine`

Owns:

- classifier training API
- classifier inference API
- fusion inference API
- Spotify auth and action APIs
- token storage for external integrations
- local mock integration behavior

Does not own:

- canonical graph state
- websocket coordination
- browser-specific APIs such as Web Bluetooth

## Monorepo Structure

```text
datapipe/
  apps/
    orchestrator/
    execution-engine/
    web/
  docs/
```

Important files and modules:

- `apps/orchestrator/lib/orchestrator/graph.ex`: graph mutation and DAG validation
- `apps/orchestrator/lib/orchestrator/graph_store.ex`: canonical graph store and runtime coordinator
- `apps/orchestrator/lib/orchestrator/packet.ex`: packet validation and route discovery
- `apps/orchestrator/lib/orchestrator/classifier_runtime.ex`: classifier node lifecycle
- `apps/orchestrator/lib/orchestrator/fusion_runtime.ex`: cooperative multi-model fusion runtime
- `apps/orchestrator/lib/orchestrator/consumer_runtime.ex`: consumer side effects and state updates
- `apps/orchestrator/lib/orchestrator/execution_engine_client.ex`: HTTP client to the worker service
- `apps/web/src/App.tsx`: main user workflow and inspector logic
- `apps/web/src/lib/bluetoothGenerator.ts`: browser Bluetooth and demo packet generation
- `apps/web/src/lib/nodeCatalog.ts`: node palette definitions
- `apps/execution-engine/src/app.js`: HTTP API contract and local runtime store
- `apps/execution-engine/src/integrations/spotify-adapter.js`: Spotify integration logic
- `apps/execution-engine/src/integrations/token-vault.js`: token persistence abstraction

## End-to-End Runtime Logic

### 1. Graph editing

Flow:

1. The web app sends websocket mutations such as `node:create` or `edge:create`.
2. `ProjectChannel` validates the envelope.
3. `GraphStore` applies the mutation through `Orchestrator.Graph`.
4. The graph is persisted to disk.
5. The orchestrator broadcasts `graph:updated`.
6. The web app reconciles the canonical snapshot with any optimistic local draft.

### 2. Packet ingest

Flow:

1. The web app creates a packet with `packet_id`, `project_id`, `node_id`, `timestamp`, `schema`, and `payload`.
2. The packet is sent through `packet:ingest`.
3. The orchestrator validates packet ownership, source compatibility, and schema.
4. The orchestrator resolves downstream route targets from the current DAG.
5. Runtime node handlers process the packet in sequence.

### 3. Classifier runtime

Classifier states:

- `idle`
- `recording`
- `training`
- `inferencing`
- `error`

Classifier flow:

1. A `vector/3` packet reaches a classifier node.
2. If the node is `recording`, the payload is appended to the current sample set.
3. If the node is `inferencing`, the classifier builds an inference window.
4. When the window is full, the orchestrator calls the execution engine.
5. The execution engine returns a `label/string` prediction.
6. The orchestrator emits a derived packet for downstream nodes.

### 4. Fusion runtime

Fusion is the first cooperative multi-model feature.

Fusion flow:

1. Upstream classifier nodes emit `label/string` packets.
2. A fusion node buffers the latest packet per input port.
3. The fusion runtime checks:
   - both required inputs exist
   - timestamps are within the configured fusion window
   - the packet pair has not already been fused
4. The orchestrator calls the execution engine fusion endpoint.
5. The execution engine applies deterministic rule matching.
6. On success, the orchestrator emits a fused `label/string` packet.
7. On no-match or missing-input conditions, the orchestrator updates the fusion node with visible diagnostics instead of failing the graph.

### 5. Consumer runtime

Current consumer behavior is implemented for Spotify.

Consumer flow:

1. A label packet reaches `Consumer.Spotify`.
2. The consumer runtime resolves the action from either:
   - a label-specific action map
   - the default configured action
3. The orchestrator calls the execution engine Spotify endpoint.
4. The execution engine executes the action in mock mode or OAuth mode.
5. The orchestrator stores canonical consumer runtime state:
   - auth
   - last action
   - last error
   - history
   - processed packet ids

## Persistence Model

### Graph persistence

The orchestrator persists the whole graph as JSON per project.

Current location:

- `apps/orchestrator/data/graphs`

Properties:

- Survives orchestrator restarts
- Stores node configuration, positions, edges, and selected runtime state
- Does not require a database in the current prototype

### Model persistence

Classifier jobs and trained models are stored in memory inside the execution engine.

Properties:

- Good enough for local iteration
- Lost when the execution engine restarts
- Means graph state can outlive model state

### Token persistence

Spotify tokens are stored only in the execution engine token vault.

Default location:

- `apps/execution-engine/.local/token-vault.json`

Properties:

- Keeps tokens out of the browser
- Keeps tokens out of the orchestrator
- Can be redirected with `DATAPIPE_TOKEN_VAULT_PATH`

## Contracts and Schemas

### Graph constraints

The orchestrator enforces:

- acyclic graph topology
- compatible source and target port schemas
- valid node and edge identifiers
- type-safe packet routing

### Important packet schemas

- `vector/3`: sensor vectors
- `label/string`: prediction labels, optionally with confidence
- `decision/object`: reserved for richer future downstream decisions

### Important websocket events

- `graph:init`
- `node:create`
- `node:update`
- `node:update_position`
- `node:delete`
- `edge:create`
- `edge:delete`
- `packet:ingest`
- `classifier:record_start`
- `classifier:record_stop`
- `classifier:train`
- `classifier:inference_start`
- `classifier:inference_stop`
- `consumer:spotify_connect`
- `consumer:spotify_auth_state`

Detailed contract references:

- `docs/contracts/graph-schema.md`
- `docs/contracts/packet-schema.md`
- `docs/contracts/websocket-events.md`
- `docs/contracts/execution-engine-api.md`

## Dependencies

### Orchestrator dependencies

Defined in `apps/orchestrator/mix.exs`.

Main runtime dependencies:

- `phoenix`
- `phoenix_pubsub`
- `jason`
- `plug_cowboy`
- `telemetry_metrics`
- `telemetry_poller`
- `dns_cluster`

Why they exist:

- Phoenix provides the web server and websocket channel layer.
- Phoenix PubSub propagates graph updates.
- Jason serializes graph snapshots and packet payloads.
- Plug Cowboy serves the HTTP/websocket endpoint.

### Execution engine dependencies

Defined in `apps/execution-engine/package.json`.

Main runtime dependency:

- `express`

Test dependency:

- `supertest`

### Web dependencies

Defined in `apps/web/package.json`.

Main runtime dependencies:

- `react`
- `react-dom`
- `phoenix`

Development dependencies:

- `vite`
- `typescript`
- `vitest`
- `jsdom`

## Configuration

### Orchestrator

Defaults from config:

- graph store directory: `apps/orchestrator/data/graphs`
- execution engine base URL: `http://127.0.0.1:4001`
- training poll interval: `100`
- dev port: `4000`

Production variables:

- `SECRET_KEY_BASE`
- `PHX_HOST`
- `PORT`

### Execution engine

Defaults:

- port: `4001`
- local vault path under `.local`

Relevant environment variables:

- `PORT`
- `SPOTIFY_CLIENT_ID`
- `SPOTIFY_CLIENT_SECRET`
- `DATAPIPE_TOKEN_VAULT_PATH`

### Web

Optional environment variables:

- `VITE_DATAPIPE_PROJECT_ID`
- `VITE_DATAPIPE_SOCKET_PATH`

## Known Constraints

These constraints are intentional or currently unresolved:

- The current build uses JSON file persistence, not PostgreSQL.
- Model storage is in-memory, not durable.
- Fusion is rule-based and deterministic, not learned.
- Web Bluetooth support depends on browser support and secure context rules.
- The built-in Bluetooth path expects micro:bit-style accelerometer data.
- Spotify is the only implemented external integration.
- `Consumer.Log` is not yet a polished sink.
- There is no general plugin API for new integrations yet.

## Error Handling Rules

Important runtime guarantees:

- Invalid graph writes are rejected server-side.
- Node execution failures do not crash the whole graph.
- Downstream failures are surfaced as node state.
- Consumer idempotency prevents duplicate external actions for the same derived packet.
- Fusion waiting/no-match states are visible in node diagnostics.

## Testing Strategy

Current test coverage includes:

- orchestrator graph and channel flows
- classifier lifecycle
- Spotify auth and action flows
- cooperative fusion routing
- web state parsing and reducers
- execution engine HTTP contracts

Useful commands:

```powershell
cd apps/orchestrator
mix test
```

```powershell
cd apps/execution-engine
npm test
```

```powershell
cd apps/web
npm test
npm run build
```

## How to Extend the System Safely

### Add a new node type

Update these areas:

1. node metadata in `apps/web/src/lib/nodeCatalog.ts`
2. graph defaults in `apps/orchestrator/lib/orchestrator/graph.ex`
3. runtime handling in orchestrator if the node changes graph state or emits packets
4. execution engine endpoints if the node needs ML or external integration behavior
5. tests for routing, validation, and UI behavior
6. docs/contracts if schemas or envelopes change

### Add a new external integration

Recommended approach:

1. Keep the browser unaware of credentials.
2. Keep integration logic in `apps/execution-engine`.
3. Add orchestration calls through `ExecutionEngineClient`.
4. Persist canonical node auth/action state in the orchestrator graph.
5. Add mock mode first, then real OAuth or API credentials.

### Add a new sensor source

Recommended approach:

1. Keep browser device access in `apps/web`.
2. Emit one of the known packet schemas or add a new schema contract.
3. Update orchestrator packet validation rules.
4. Add downstream node support for the new schema.

## Recommended Reading Order

For a new contributor:

1. `README.md`
2. `docs/contracts/graph-schema.md`
3. `docs/contracts/packet-schema.md`
4. `docs/contracts/websocket-events.md`
5. `docs/contracts/execution-engine-api.md`
6. `docs/integration-checkpoint.md`
7. `docs/phase-5-spec.md`
