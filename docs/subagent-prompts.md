# Subagent Execution Prompts

Use these prompts to run implementation in controlled, phase-specific chunks.

## Phase 1 Subagent Prompt (Orchestrator + Canvas)

Implement Phase 1 for DataPipe in a monorepo:

- Build Elixir/Phoenix orchestrator app with channels and project-scoped graph state.
- Build a web canvas app that supports creating, moving, deleting nodes and connecting edges.
- Implement server-side DAG validation (cycle prevention + port compatibility checks).
- Persist nodes/edges in PostgreSQL and cache active project state in-memory.
- Add channel integration tests for all graph mutation events.

Constraints:

- Graph is source of truth in orchestrator.
- Broadcast canonical graph state updates to all subscribers after each accepted mutation.
- Reject invalid mutations with structured errors:
  - `code`
  - `message`
  - `request_id`
- Keep node model generic (`Generator`, `Modifier`, `Consumer`) with JSON configuration.

Return:

- files changed
- run/test commands
- any blocked setup steps

## Phase 2 Subagent Prompt (Bluetooth Streaming)

Implement Phase 2 for DataPipe:

- Add a Bluetooth generator node in frontend.
- Stream vector packets to orchestrator over websocket.
- Validate and rate-limit packet ingestion server-side.
- Broadcast packet flow to subscribed clients and downstream node handlers.
- Add UI feedback for connect/disconnect/error.

Constraints:

- Packet schema fields:
  - `packet_id`
  - `project_id`
  - `node_id`
  - `timestamp`
  - `payload`
  - `schema`
- Handle reconnects without duplicating active stream producers.
- Surface schema validation errors in node UI state.

Return:

- files changed
- packet schema details
- manual verification steps

## Phase 3 Subagent Prompt (ML Worker)

Implement Phase 3 for DataPipe:

- Add Node.js execution-engine service.
- Implement classifier lifecycle (`idle`, `recording`, `training`, `inferencing`, `error`) in orchestrator.
- Add record buffer and labeled sample management.
- Dispatch training jobs to execution engine and handle status updates.
- Implement inference endpoint and packet label output routing.

Constraints:

- Training failures must not crash session GenServer.
- Add timeout + retry policy for training dispatch.
- Persist model metadata and last successful model reference.

Return:

- files changed
- API contract between orchestrator and execution engine
- test coverage summary

## Phase 4 Subagent Prompt (Spotify Consumer)

Implement Phase 4 for DataPipe:

- Add Spotify integration in execution engine with OAuth and token refresh.
- Add consumer node config mapping labels to actions.
- Trigger Spotify playback actions from label packets.
- Add retries, user-visible errors, and action audit log.

Constraints:

- Token refresh handled automatically before action dispatch.
- Do not expose secrets to frontend.
- Use idempotency key for repeated packet deliveries.

Return:

- files changed
- OAuth setup/env requirements
- end-to-end verification checklist
