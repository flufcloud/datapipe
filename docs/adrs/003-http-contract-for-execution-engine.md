# ADR 003: HTTP Contract For Execution Engine

## Status

Accepted

## Context

The execution engine must be integrated quickly for Phase 3 while remaining debuggable in local development.

## Decision

Use versioned HTTP JSON APIs between orchestrator and execution engine for the MVP.

## Consequences

- Faster initial implementation and debugging
- Easier local testing with simple HTTP clients
- Possible future migration to gRPC if throughput or streaming needs justify it
