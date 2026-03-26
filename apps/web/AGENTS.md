# Web Agent Guide

## Mission

Build the browser UI for creating, connecting, and monitoring nodes on a realtime canvas.

## Own

- SPA scaffold
- canvas interactions
- websocket client
- graph rendering
- node inspector and status display
- Phase 2 Bluetooth browser integration

## Rules

- Do not treat client state as canonical.
- Reconcile local state with canonical server updates.
- Keep components typed and small.
- Prefer simple interaction flows over complex canvas abstractions in v1.
- Surface backend validation errors directly in the UI.

## Required UX

- create node
- drag node
- connect and disconnect edges
- reconnect websocket cleanly
- show node status and error state
