# ADR 001: Monorepo And Service Boundaries

## Status

Accepted

## Context

DataPipe needs a Phoenix orchestrator, a web SPA, and a Node.js execution runtime that evolve together.

## Decision

Use a monorepo with three top-level apps:

- `apps/orchestrator`
- `apps/web`
- `apps/execution-engine`

## Consequences

- Shared docs and contracts live in one repo.
- Cross-service changes are easier to review together.
- Service boundaries remain explicit through documented contracts.
