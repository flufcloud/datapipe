# DataPipe First Integration Check

## Scope

This checkpoint validates the first shared milestone from `docs/agent-kickoff.md` and records the Phase 2, Phase 3, Phase 4, and Phase 5 runtime follow-ups.

## Verified Against Code

### Web

- joins the `project:{project_id}` topic through the Phoenix client
- requests `graph:init` after channel readiness
- renders canonical graph snapshots from `graph:init` and `graph:updated`
- tracks connection status and server errors in the UI
- now sends the full mutation envelope with `event`, `request_id`, `project_id`, and `payload`

### Orchestrator

- accepts `project:{project_id}` topics
- pushes a canonical empty graph after join
- accepts `graph:init`
- supports phase-1 mutation names through the graph domain module
- validates websocket envelopes and returns structured `error` payloads
- accepts `packet:ingest` and broadcasts `packet:observed` with computed route targets

### Execution Engine

- exposes `GET /health`
- exposes `POST /api/v1/classifier/train`
- exposes `POST /api/v1/classifier/infer`
- exposes `POST /api/v1/fusion/infer`
- exposes Spotify auth-state and connect endpoints for local mock and OAuth-backed flows
- exposes `POST /api/v1/integrations/spotify/action`
- returns structured JSON responses and invalid-request errors

## Phase 2 Follow-Up

- The web app now includes a `Generator.Bluetooth` node template and Bluetooth/demo stream controls.
- The orchestrator validates packet shape and source node compatibility before broadcasting runtime packet events.
- A live runtime socket check created a Bluetooth node, connected it to a classifier node, ingested a packet, and observed a successful `packet:observed` broadcast.

## Phase 3 Follow-Up

- The orchestrator now supports classifier lifecycle events for recording, training, and live inference.
- The execution engine now exposes asynchronous training jobs and in-memory model metadata for local development.
- A live runtime check completed the full flow:
  - create Bluetooth and classifier nodes
  - record a labeled sample
  - train the classifier through the execution engine
  - receive async `graph:updated` when training completed
  - emit a `label/string` packet from the classifier during live inference

## Phase 4 Follow-Up

- The web app now includes a `Consumer.Spotify` node with action selection, connection controls, auth-state refresh, and canonical action-history visibility.
- The orchestrator now routes classifier-emitted `label/string` packets into `Consumer.Spotify` nodes and persists action/auth runtime state in the canonical graph.
- The execution engine now supports:
  - local mock Spotify connection for development
  - OAuth preparation endpoints for real credentials
  - token vault storage inside the execution engine only
  - idempotent Spotify action execution
- A live runtime check completed the full prototype loop:
  - create Bluetooth, classifier, and Spotify consumer nodes
  - connect the Spotify consumer through the orchestrator
  - record and train the classifier
  - emit a live classifier label
  - trigger a successful mock Spotify `next_track` action
  - observe the action result persisted in canonical graph state

## Phase 5 Follow-Up

- The web app now includes a `Modifier.Fusion` node with configurable left/right rule labels, a fusion window, upstream dependency visibility, and intermediate-model inspection.
- The orchestrator now recursively routes runtime packets so classifier outputs can feed fusion nodes and fusion outputs can immediately feed downstream consumers in the same packet flow.
- The execution engine now exposes a deterministic `POST /api/v1/fusion/infer` contract so cooperative multi-model logic stays in the execution engine boundary.
- A live runtime-shaped channel test now completes the cooperative pipeline:
  - create one Bluetooth generator
  - create two classifier nodes
  - create one fusion node and one Spotify consumer
  - route both classifier outputs into fusion
  - emit a fused `music_control` label
  - trigger a downstream mock Spotify action from the fused result

## Contract Notes

- The orchestrator sends an initial `graph:updated` push after join with `request_id: null`.
- The web client is tolerant of both server-pushed graph snapshots and explicit `graph:init` responses.
- `GET /api/v1/jobs/:job_id` is now implemented and used by the orchestrator training poll loop.
- `POST /api/v1/fusion/infer` now powers `Modifier.Fusion` nodes for cooperative multi-model inference.
- Spotify consumer auth/action state is persisted on `Consumer.Spotify` nodes under `configuration.spotify`.
- Fusion runtime state is persisted on `Modifier.Fusion` nodes under `configuration.fusion`.

## Remaining Gaps

- True browser-device validation with a physical Bluetooth peripheral still needs to be exercised manually.
- Training jobs and model storage are in-memory in the execution engine and are not yet durable across service restarts.
- Real Spotify OAuth callback completion still needs a browser-based manual validation with actual credentials.
- The current fusion node uses deterministic rule matching; learned multimodal fusion models are still future work.

## Milestone Result

The first working prototype milestone is now satisfied at the code and contract level: Phase 2 packet streaming, Phase 3 classifier lifecycle, Phase 4 first consumer integration, and the first Phase 5 cooperative multi-model slice are implemented and runtime-checked.

The next required verification step is to run:

- `mix deps.get && mix test` in `apps/orchestrator`
- `npm install && npm run test && npm run build` in `apps/web`
- `npm test` in `apps/execution-engine`

Then confirm a live browser session can drive record/train/infer/action entirely from the UI, manually validate a real Bluetooth device stream, and manually validate a real Spotify OAuth flow with credentials.
