# Packet Schema

## Base Packet

```json
{
  "packet_id": "pkt_123",
  "project_id": "proj_123",
  "node_id": "node_source",
  "timestamp": "2026-03-19T12:00:00.000Z",
  "schema": "vector/3",
  "payload": {}
}
```

## Common Schemas

- `scalar/number`
- `vector/3`
- `label/string`
- `decision/object`
- `event/trigger`

## Example: Vector Packet

```json
{
  "packet_id": "pkt_123",
  "project_id": "proj_123",
  "node_id": "node_bluetooth",
  "timestamp": "2026-03-19T12:00:00.000Z",
  "schema": "vector/3",
  "payload": {
    "x": 0.12,
    "y": -0.44,
    "z": 0.91
  }
}
```

## Rules

- `packet_id` must be unique per emitted packet.
- Derived runtime packets may use deterministic ids derived from the upstream packet and emitting node so downstream integrations can apply idempotency safely.
- `schema` determines payload validation.
- Orchestrator validates schema before routing.
- Invalid packets are rejected and surfaced as node errors.
- `label/string` packets may include `confidence` when emitted by model-capable nodes.
- `decision/object` packets reserve a richer shape for future cooperative-model outputs that need explicit input provenance.

## Runtime Routing Payload

When the orchestrator accepts a packet, it broadcasts `packet:observed` with:

```json
{
  "packet": {},
  "route_targets": [
    {
      "node_id": "node_classifier",
      "source_port": "out",
      "target_port": "in"
    }
  ]
}
```
