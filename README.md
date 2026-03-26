# DataPipe

DataPipe is a visual “sensor‑to‑action” canvas. You drag blocks onto a graph, stream live motion data in, teach small models what patterns mean (like “clockwise gesture”), combine multiple models into a higher‑level decision, and finally trigger external software (Spotify) when that decision happens.

Think of it as a **hands‑on lab for interactive IoT + ML pipelines**, not a production platform: it’s designed so you can see packets, models, and actions all evolving in real time on one screen.

## Prerequisites

- **OS**: Windows 10+ (scripts are PowerShell‑based; other OSes can run the underlying commands manually)
- **Node.js**: v20 or newer
- **Elixir**: v1.14 or newer
- **Erlang/OTP**: compatible with your Elixir install
- **Browser**: a recent Chromium‑family browser with Web Bluetooth support (for real devices)

You do **not** need PostgreSQL or Redis for this prototype. Graphs are persisted to JSON files and tokens are stored in a local JSON vault.

## Verify Installation (Single Command)

From the repository root in **PowerShell**:

```powershell
.\scripts\verify.ps1
```

This script will:

- install and test the **execution engine** (`apps/execution-engine`)
- install, test, and build the **web app** (`apps/web`)
- install dependencies and run tests for the **orchestrator** (`apps/orchestrator`)

If it completes without errors, your local environment is ready.

## Start DataPipe (Single Command)

From the repository root in **PowerShell**:

```powershell
.\scripts\dev.ps1
```

This will:

- open three new PowerShell windows:
  - execution engine on `http://127.0.0.1:4001`
  - orchestrator (Phoenix) on `http://127.0.0.1:4000`
  - web app dev server
- print a link you can click:

```text
DataPipe is booting. Once Vite finishes compiling, open:
  http://127.0.0.1:5173
```

Wait until the Vite dev server finishes compiling, then open `http://127.0.0.1:5173` in your browser.

## End-User Walkthrough

This is the simplest full workflow.

### Build a basic classifier pipeline

1. Add a `Bluetooth Sensor` node.
2. Add a `Classifier` node.
3. Connect `Bluetooth Sensor.out` to `Classifier.in`.
4. Select the classifier node.
5. Enter a recording label such as `clockwise`.
6. Start a data stream from the Bluetooth node.
7. Click `Start Recording`, let a few packets arrive, then click `Stop Recording`.
8. Click `Train Model`.
9. Click `Start Live Inference`.
10. Watch the classifier inspector for live prediction packets.

### Build a cooperative multi-model pipeline

1. Add one `Bluetooth Sensor`.
2. Add two `Classifier` nodes.
3. Add one `Fusion` node.
4. Connect the Bluetooth node to both classifiers.
5. Connect `Classifier A.label` to `Fusion.left`.
6. Connect `Classifier B.label` to `Fusion.right`.
7. Configure the fusion rule in the Fusion inspector.
8. Run live inference.
9. Watch the Fusion inspector for latest inputs, latest prediction, and confidence.

### Trigger Spotify from a fused result

1. Add a `Spotify Control` node.
2. Connect `Fusion.label` to `Spotify Control.in`.
3. Configure the Spotify node action or label mapping.
4. Connect Spotify in mock mode or OAuth mode.
5. Emit the label that matches the configured rule.
6. Confirm the Spotify action appears in `Recent Spotify Actions`.

## How to Use the Canvas

### Add nodes

- Use the `Node Palette`.
- Click `Add <Node Name>`.
- The node appears on the canvas and in the project snapshot panel.

### Connect nodes

- Use the `Edge Builder`.
- Pick a source node and source port.
- Pick a target node and target port.
- Click `Connect Nodes`.

### Move nodes

- Drag a node on the canvas.
- Release to persist the new position.

### Inspect nodes

- Click a node on the canvas or in the project snapshot.
- Use the inspector to view:
  - role
  - input schemas
  - output schemas
  - upstream dependencies
  - packet count
  - node-specific controls and runtime state

### Delete nodes or edges

- Select a node and click `Delete Node`.
- Remove edges from the `Project Snapshot` section.

## IoT Integration

### Supported IoT path today

The current prototype supports browser-side Bluetooth accelerometer streaming through the Web Bluetooth API.

Supported input shape:

- `vector/3`
- payload: `{ "x": number, "y": number, "z": number }`

### Demo mode

If you do not have a Bluetooth device, use the built-in demo stream.

How to use it:

1. Add a `Bluetooth Sensor` node.
2. Select the node.
3. Click `Start Demo Stream`.
4. The node will emit synthetic vector data every 150 ms.

Use this mode for:

- UI exploration
- classifier training tests
- fusion tests
- Spotify integration tests

### Real Bluetooth device mode

The browser integration currently targets a micro:bit-style accelerometer service.

Built-in service assumptions:

- service UUID: `e95d0753-251d-470a-a062-fa1922dfa9a8`
- data characteristic UUID: `e95dca4b-251d-470a-a062-fa1922dfa9a8`
- sample period characteristic UUID: `e95dfb24-251d-470a-a062-fa1922dfa9a8`

How to connect:

1. Open the web app in a browser that supports Web Bluetooth.
2. Add a `Bluetooth Sensor` node.
3. Select the node.
4. Click `Connect Device`.
5. Approve the Bluetooth device chooser.
6. Start streaming and watch packet activity in the inspector.

Important constraints:

- Web Bluetooth generally works only on secure origins such as `https://` or `localhost`.
- The current device integration expects accelerometer data that can be decoded as three signed 16-bit values.
- If the sample-period characteristic is unavailable, DataPipe falls back to the device default rate.
- Device pairing, permissions, and disconnect behavior are controlled by the browser.

### Integrating a different IoT device

To support another Bluetooth device, update the browser adapter in `apps/web/src/lib/bluetoothGenerator.ts`.

You will typically need to change:

- the service UUID
- the data characteristic UUID
- the packet decoding logic
- any device-specific sampling configuration

The rest of the platform can stay the same as long as the browser adapter emits valid `vector/3` packets.

## External Software Integration

### Spotify integration overview

Spotify is the current external software integration. It is implemented only in the execution engine.

This means:

- the browser never holds Spotify tokens
- the orchestrator never talks directly to Spotify
- all credentials and token refresh behavior stay in `apps/execution-engine`

### Local mock mode

If `SPOTIFY_CLIENT_ID` and `SPOTIFY_CLIENT_SECRET` are not set, DataPipe uses mock Spotify mode automatically.

In mock mode:

- `Connect Spotify` creates a local fake connection
- actions update mock playback state in the execution engine
- no real Spotify account is required
- action history still appears in the UI

This is the recommended way to test the full DataPipe workflow first.

### Real Spotify OAuth mode

Before starting the execution engine, create a Spotify developer app and register this redirect URI:

```text
http://127.0.0.1:4001/api/v1/integrations/spotify/callback
```

Then start the execution engine with:

```powershell
$env:SPOTIFY_CLIENT_ID="your_client_id"
$env:SPOTIFY_CLIENT_SECRET="your_client_secret"
npm start
```

Optional:

```powershell
$env:DATAPIPE_TOKEN_VAULT_PATH="C:\path\to\token-vault.json"
```

How OAuth works:

1. Click `Connect Spotify` in the Spotify node inspector.
2. The execution engine creates an authorization URL.
3. The orchestrator persists the returned auth state into the canonical graph.
4. The UI shows `Open Spotify Authorization`.
5. Complete authorization in the browser.
6. Refresh auth state if needed.
7. Use live labels to trigger real Spotify actions.

Important notes:

- The callback URL is built from the execution engine base URL and points to `/api/v1/integrations/spotify/callback`.
- Tokens are stored only in the execution engine token vault.
- Your Spotify app redirect URI must match the execution engine callback URL exactly.
- The current implementation supports these actions:
  - `next_track`
  - `previous_track`
  - `play_pause`

### Mapping labels to external actions

Spotify nodes support:

- one default action
- per-label action mappings

Typical pattern:

- classifier emits `clockwise`
- fusion emits `music_control`
- Spotify node maps `music_control -> next_track`

## Configuration

### Orchestrator

Default runtime behavior:

- port: `4000`
- execution engine base URL: `http://127.0.0.1:4001`
- graph persistence directory: `apps/orchestrator/data/graphs`
- training poll interval: `100ms`

Production-only vars used by Phoenix:

- `SECRET_KEY_BASE`
- `PHX_HOST`
- `PORT`

### Execution engine

Default runtime behavior:

- port: `4001`
- local token vault path: `apps/execution-engine/.local/token-vault.json`

Relevant environment variables:

- `PORT`
- `SPOTIFY_CLIENT_ID`
- `SPOTIFY_CLIENT_SECRET`
- `DATAPIPE_TOKEN_VAULT_PATH`

### Web app

Optional environment variables:

- `VITE_DATAPIPE_PROJECT_ID`
- `VITE_DATAPIPE_SOCKET_PATH`

Defaults:

- project id: `proj_demo`
- socket path: `ws://localhost:4000/socket`

## Data and Graph Rules

The orchestrator enforces these core rules:

- The graph must remain acyclic.
- Edge schemas must be compatible.
- Packets must belong to the active project.
- Packet schemas must match the emitting node output.
- Invalid packets are rejected with visible errors.
- External integrations do not run in the browser or orchestrator.

Important packet schemas:

- `vector/3`
- `label/string`
- `decision/object` reserved for richer future outputs

## Persistence and State

Current persistence model:

- Graphs are stored as JSON snapshots under `apps/orchestrator/data/graphs`.
- Spotify tokens are stored in the execution engine token vault.
- Training jobs and model metadata are in-memory inside the execution engine.

Practical meaning:

- Graph layout and configuration survive orchestrator restarts.
- Spotify auth can survive execution-engine restarts if the local vault file is preserved.
- Trained models do not currently survive execution-engine restarts.

## Dependencies

Main runtime dependencies:

- Phoenix and Phoenix PubSub in `apps/orchestrator`
- Express in `apps/execution-engine`
- React, Vite, and the Phoenix JS client in `apps/web`

Testing dependencies:

- ExUnit for orchestrator tests
- Node built-in test runner and `supertest` for execution engine tests
- Vitest for web tests

## Validate the Installation

Run these commands after setup:

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

## Current Constraints and Limits

This prototype is intentionally narrow. Current limits include:

- Bluetooth input is browser-driven, not server-side.
- The built-in Bluetooth path targets accelerometer-style `vector/3` data.
- Fusion is rule-based, not a learned multimodal model.
- The execution engine stores models in memory.
- Spotify is the only implemented external software integration.
- There is no generic plugin system yet for arbitrary device or API adapters.
- `Consumer.Log` exists in the graph model but is not yet a polished end-user sink.

## Troubleshooting

### The web app cannot connect

Check:

- orchestrator is running on port `4000`
- the web app is using the correct websocket URL
- the browser console does not show websocket errors

### Bluetooth is unavailable

Check:

- your browser supports Web Bluetooth
- you are using `localhost` or `https`
- the device exposes the expected service and characteristic UUIDs

### Spotify does not connect

If you want local testing, remove Spotify credentials and use mock mode.

If you want real Spotify:

- confirm `SPOTIFY_CLIENT_ID` and `SPOTIFY_CLIENT_SECRET` are set
- confirm the redirect URI matches your Spotify app settings
- confirm the execution engine is reachable on the URL used to build the callback

### Training or inference state looks wrong after restarting services

Remember:

- graph state persists
- execution-engine model memory does not

If needed, retrain the classifier after restarting the execution engine.

## Further Documentation

- `docs/developer-guide.md`: internal architecture, code flow, constraints, dependencies, and extension points
- `docs/contracts/graph-schema.md`
- `docs/contracts/packet-schema.md`
- `docs/contracts/websocket-events.md`
- `docs/contracts/execution-engine-api.md`
- `docs/integration-checkpoint.md`
- `docs/phase-5-spec.md`
