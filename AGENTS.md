# DataPipe Agent Guide

## Repo Shape

- `apps/orchestrator`: Phoenix control plane and canonical graph state
- `apps/web`: browser canvas SPA
- `apps/execution-engine`: Node.js ML and integration runtime
- `docs`: contracts, ADRs, and plans

## Global Rules

- The orchestrator is the source of truth for graph state.
- All graph mutations are validated server-side before commit.
- The frontend may be optimistic, but must reconcile with canonical server updates.
- ML execution and external APIs live in `apps/execution-engine` only.
- Do not change cross-service payloads without updating `docs/contracts/`.
- Prefer simple, explicit contracts over premature abstraction.

## Shared Envelopes

- Websocket messages use `event`, `request_id`, `project_id`, and `payload`.
- Stream packets use `packet_id`, `project_id`, `node_id`, `timestamp`, `payload`, and `schema`.
- Errors must be structured, stable, and user-displayable.

## Delivery Priority

1. Phase 1: graph editing and realtime sync
2. Phase 2: Bluetooth ingestion
3. Phase 3: classifier lifecycle
4. Phase 4: Spotify consumer

## Testing Expectations

- Add tests for every state transition and network contract.
- Keep phase scope minimal and verifiable.
- Prefer integration tests around graph mutation and sync behavior.
