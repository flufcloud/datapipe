# DataPipe Agent Kickoff

## Shared Definition Of Done

- Contracts in `docs/contracts/` are treated as frozen unless Architecture approves a change.
- App agents work inside their own app directories plus directly related tests.
- Every agent returns changed files, run commands, tests run, blockers, and open contract questions.

## Handoff Boundaries

- Architecture owns `docs/contracts/*`, `docs/adrs/*`, and root `AGENTS.md`.
- Orchestrator consumes `docs/contracts/websocket-events.md` and `docs/contracts/graph-schema.md`.
- Web consumes `docs/contracts/websocket-events.md` and `docs/contracts/graph-schema.md`.
- Execution Engine consumes `docs/contracts/execution-engine-api.md` and `docs/contracts/packet-schema.md`.
- Contract changes must be proposed in docs before implementation changes land.

## Day 1 Task Board

### Architecture + Contracts

First commit:

- add `AGENTS.md`
- add `docs/contracts/*`
- add `docs/adrs/*`

Done when:

- all shared payloads are documented
- app agents can start without inventing new message shapes

### Orchestrator

First commit:

- scaffold Phoenix app in `apps/orchestrator`
- add channel topic for `project:{project_id}`
- add minimal graph init endpoint over channels

Non-goals:

- Bluetooth ingestion
- ML execution
- external OAuth

Done when:

- a client can join a project topic and receive a canonical empty graph
- graph mutation event names match the websocket contract

### Web

First commit:

- scaffold `React + TypeScript + Vite` app in `apps/web`
- add websocket client module
- render a minimal canvas shell with graph snapshot state

Non-goals:

- Bluetooth device access
- classifier UX
- Spotify-specific UI

Done when:

- app can connect to orchestrator
- app can render canonical graph state received from channels

### Execution Engine

First commit:

- scaffold Node.js service in `apps/execution-engine`
- add `GET /health`
- add stub `POST /classifier/train`
- add stub `POST /classifier/infer`
- add stub `POST /integrations/spotify/action`

Non-goals:

- real model training
- real Spotify OAuth
- persistent model registry

Done when:

- endpoints exist and match the HTTP contract shapes
- responses are structured and stable enough for orchestrator integration

## First Integration Check

At the end of the first milestone verify:

1. Web joins `project:{project_id}` and can render `graph:updated` payloads.
2. Orchestrator accepts `graph:init` and phase-1 mutation events from the contract.
3. Execution Engine exposes `/health`, `/classifier/train`, `/classifier/infer`, and `/integrations/spotify/action`.
4. No app agent redefined shared payloads locally.
