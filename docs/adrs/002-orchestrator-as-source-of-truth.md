# ADR 002: Orchestrator As Source Of Truth

## Status

Accepted

## Context

The graph must stay consistent across multiple clients and runtime services.

## Decision

The Phoenix orchestrator owns canonical graph state, validates every mutation, persists accepted changes, and broadcasts the resulting graph snapshot.

## Consequences

- Clients stay simpler and can recover from reconnects.
- DAG validation is centralized.
- Execution services cannot mutate graph state directly.
