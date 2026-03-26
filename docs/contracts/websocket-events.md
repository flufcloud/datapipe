# Websocket Events

## Topic

- `project:{project_id}`

## Message Envelope

```json
{
  "event": "node:create",
  "request_id": "req_123",
  "project_id": "proj_123",
  "payload": {}
}
```

## Success Envelope

```json
{
  "event": "graph:updated",
  "request_id": "req_123",
  "project_id": "proj_123",
  "payload": {
    "graph": {}
  }
}
```

## Error Envelope

```json
{
  "event": "error",
  "request_id": "req_123",
  "project_id": "proj_123",
  "payload": {
    "code": "cycle_detected",
    "message": "Edge creation would introduce a cycle",
    "details": {}
  }
}
```

## Graph Events

- `graph:init`
- `node:create`
- `node:update`
- `node:update_position`
- `node:delete`
- `edge:create`
- `edge:delete`

## Packet Events

- `packet:ingest`
- `packet:observed`

`packet:ingest` may also emit a `graph:updated` broadcast when runtime packet handling mutates canonical node state, such as:

- classifier recording or inference state changes
- `Modifier.Fusion` input buffers, latest fused output, or waiting diagnostics
- `Consumer.Spotify` action history, last action, or error state changes

## Classifier Events

- `classifier:record_start`
- `classifier:record_stop`
- `classifier:train`
- `classifier:inference_start`
- `classifier:inference_stop`

## Consumer Events

- `consumer:spotify_connect`
- `consumer:spotify_auth_state`

Request payload:

```json
{
  "id": "node_spotify"
}
```

Semantics:

- `consumer:spotify_connect` asks the orchestrator to initiate or refresh a Spotify connection for the target consumer node.
- `consumer:spotify_auth_state` asks the orchestrator to read current Spotify connection state from the execution engine and persist it into the canonical graph.
- Both events respond via `graph:updated`; connection/auth state lives in the canonical node configuration rather than a separate websocket envelope.

## Classifier Async Updates

- Long-running classifier training completes via a later `graph:updated` broadcast.
- The current implementation uses `request_id: "training:completed"` for successful async completion and `request_id: "training:failed"` for async failure state changes.

## Packet Observation Envelope

```json
{
  "event": "packet:observed",
  "request_id": "req_456",
  "project_id": "proj_123",
  "payload": {
    "packet": {},
    "route_targets": [
      {
        "node_id": "node_classifier",
        "source_port": "out",
        "target_port": "in"
      }
    ]
  }
}
```

## Broadcast Rule

- After every accepted mutation, broadcast `graph:updated` with the full canonical graph snapshot.
- Runtime packet processing also broadcasts `graph:updated` when the persisted graph changes as a side effect of packet handling.

## Validation Rule

- Server validates IDs, shape, port compatibility, and cycle safety before commit.
- `packet:ingest` also validates packet schema, packet project ownership, and source node compatibility.
