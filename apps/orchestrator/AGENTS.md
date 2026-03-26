# Orchestrator Agent Guide

## Mission

Build the Phoenix backend that owns project graph state, validates mutations, persists the DAG, and broadcasts canonical updates.

## Own

- Phoenix app structure
- Channel topics and events
- `GraphState` process model
- DAG validation
- PostgreSQL persistence
- backend integration tests

## Rules

- Treat orchestrator state as canonical.
- Reject invalid graph mutations before persistence.
- Prevent cycles on edge creation.
- Broadcast normalized graph state after accepted mutations.
- Keep node types generic unless a phase requires specialization.
- Node or worker failures must not crash the whole project session.

## Required Tests

- channel join and graph init
- node create, move, update, delete
- edge create and delete
- cycle rejection
- graph reload from persistence
