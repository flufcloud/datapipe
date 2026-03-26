# Graph Schema

## Project

```json
{
  "id": "proj_123",
  "name": "Untitled Project",
  "version": 1
}
```

## Node

```json
{
  "id": "node_123",
  "type": "Generator.ManualTest",
  "category": "Generator",
  "label": "Manual Input",
  "position": { "x": 120, "y": 240 },
  "configuration": {},
  "ports": {
    "inputs": [],
    "outputs": [
      { "name": "out", "schema": "vector/3" }
    ]
  },
  "status": "idle"
}
```

## Edge

```json
{
  "id": "edge_123",
  "source_id": "node_a",
  "source_port": "out",
  "target_id": "node_b",
  "target_port": "in"
}
```

## Graph Snapshot

```json
{
  "project": {},
  "nodes": [],
  "edges": []
}
```

## Rules

- Graph must remain acyclic.
- Port schemas must be compatible.
- `configuration` is node-specific and stored as JSON.
- `status` is derived runtime state and may be persisted only when useful for restore UX.

## Initial Node Catalog

- `Generator.ManualTest`
- `Generator.Bluetooth`
- `Modifier.Classifier`
- `Modifier.Fusion`
- `Consumer.Log`
- `Consumer.Spotify`

## Modifier.Fusion Runtime Shape

`Modifier.Fusion` stores its runtime metadata inside `configuration.fusion`:

```json
{
  "window_ms": 5000,
  "rules": [
    {
      "left_label": "clockwise",
      "right_label": "active",
      "output_label": "music_control",
      "confidence": 0.95
    }
  ],
  "latest_inputs": {
    "left": {
      "packet_id": "pkt_classifier:node_gesture:pkt_123",
      "timestamp": "2026-03-19T12:00:00.000Z",
      "label": "clockwise",
      "confidence": 0.91,
      "source_node_id": "node_gesture"
    }
  },
  "last_output": {
    "label": "music_control",
    "confidence": 0.95,
    "timestamp": "2026-03-19T12:00:00.250Z",
    "inputs": []
  },
  "last_error": null,
  "last_combination_id": "pkt_classifier:node_gesture:pkt_123|pkt_classifier:node_context:pkt_123"
}
```

Rules:

- `rules` are matched against the `left` and `right` input ports in order.
- `latest_inputs` stores the most recent intermediate prediction seen per input port.
- `last_output` captures the latest successful fused prediction shown by the UI.
- `last_error` surfaces waiting/no-match/timeout diagnostics or runtime failures without crashing the graph.
- `last_combination_id` prevents replaying the same pair of upstream prediction packets.

## Consumer.Spotify Runtime Shape

`Consumer.Spotify` stores its runtime metadata inside `configuration.spotify`:

```json
{
  "action": null,
  "label_actions": {
    "clockwise": "next_track"
  },
  "auth": {
    "provider": "spotify",
    "status": "connected",
    "mode": "mock",
    "authorization_url": null,
    "state": null,
    "connection": {
      "connected": true,
      "account": {
        "id": "mock-user",
        "display_name": "Local Mock Spotify",
        "product": "dev"
      }
    }
  },
  "last_action": null,
  "last_error": null,
  "history": [],
  "processed_packet_ids": []
}
```

Rules:

- `label_actions` maps incoming `label/string` packet labels to execution-engine Spotify actions.
- `last_action`, `last_error`, and `history` are canonical runtime state and are updated by packet handling.
- `history` is stored newest-first so the first entry is the latest visible attempt in the UI.
- `processed_packet_ids` is a bounded idempotency guard for downstream external actions.
