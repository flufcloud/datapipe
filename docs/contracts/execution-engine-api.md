# Execution Engine API

## Base Path

- `/api/v1`

## Auth

- Internal service-to-service auth only for MVP.
- No browser calls directly into execution engine.

## Health Check

- `GET /health`

Response:

```json
{
  "status": "ok"
}
```

## Train Model

- `POST /classifier/train`

Request:

```json
{
  "project_id": "proj_123",
  "node_id": "node_classifier",
  "dataset": {
    "labels": ["clockwise", "counterclockwise"],
    "samples": []
  },
  "config": {
    "window_size": 30,
    "epochs": 20
  }
}
```

Response:

```json
{
  "job_id": "job_123",
  "status": "queued"
}
```

## Job Status

- `GET /api/v1/jobs/:job_id`

Response:

```json
{
  "job_id": "job_123",
  "status": "running",
  "progress": 42
}
```

Completed response:

```json
{
  "job_id": "job_123",
  "status": "completed",
  "progress": 100,
  "result": {
    "model_id": "model_123",
    "labels": ["clockwise", "counterclockwise"],
    "window_size": 8
  }
}
```

## Run Inference

- `POST /classifier/infer`

Request:

```json
{
  "project_id": "proj_123",
  "node_id": "node_classifier",
  "model_id": "model_123",
  "vector_window": []
}
```

Response:

```json
{
  "label": "clockwise",
  "confidence": 0.94
}
```

Notes:

- The current implementation stores job and model metadata in-memory for local development.
- Training is asynchronous and must be observed through the job status endpoint.

## Run Fusion

- `POST /fusion/infer`

Request:

```json
{
  "project_id": "proj_123",
  "node_id": "node_fusion",
  "inputs": {
    "left": {
      "label": "clockwise",
      "confidence": 0.91,
      "source_node_id": "node_gesture"
    },
    "right": {
      "label": "active",
      "confidence": 0.82,
      "source_node_id": "node_context"
    }
  },
  "config": {
    "window_ms": 5000,
    "rules": [
      {
        "left_label": "clockwise",
        "right_label": "active",
        "output_label": "music_control",
        "confidence": 0.95
      }
    ]
  }
}
```

Matched response:

```json
{
  "matched": true,
  "label": "music_control",
  "confidence": 0.95,
  "matched_rule": {
    "left_label": "clockwise",
    "right_label": "active",
    "output_label": "music_control"
  },
  "inputs": [
    {
      "port": "left",
      "label": "clockwise",
      "confidence": 0.91,
      "source_node_id": "node_gesture"
    },
    {
      "port": "right",
      "label": "active",
      "confidence": 0.82,
      "source_node_id": "node_context"
    }
  ]
}
```

No-match response:

```json
{
  "matched": false,
  "reason": "no_rule_match"
}
```

Notes:

- This endpoint keeps cooperative-model decision logic in the execution engine while the orchestrator remains the routing authority.
- The current implementation uses deterministic rule matching rather than a learned fusion model so the full Phase 5 UX can be exercised locally.

## Spotify Auth State

- `GET /integrations/spotify/auth-state?project_id=proj_123`

Response:

```json
{
  "provider": "spotify",
  "project_id": "proj_123",
  "status": "not_connected",
  "mode": "mock",
  "available_actions": ["next_track", "previous_track", "play_pause"],
  "connection": {
    "connected": false
  }
}
```

Authorization-required response:

```json
{
  "provider": "spotify",
  "project_id": "proj_123",
  "status": "authorization_required",
  "mode": "oauth",
  "authorization_url": "https://accounts.spotify.com/authorize?...",
  "state": "opaque_state_from_orchestrator",
  "available_actions": ["next_track", "previous_track", "play_pause"],
  "connection": {
    "connected": false
  }
}
```

Connected response:

```json
{
  "provider": "spotify",
  "project_id": "proj_123",
  "status": "connected",
  "mode": "mock",
  "available_actions": ["next_track", "previous_track", "play_pause"],
  "connection": {
    "connected": true,
    "connected_at": "2026-03-19T10:00:00.000Z",
    "updated_at": "2026-03-19T10:00:00.000Z",
    "scopes": ["user-modify-playback-state", "user-read-playback-state"],
    "account": {
      "id": "mock-user",
      "display_name": "Local Mock Spotify",
      "product": "dev"
    },
    "mock_playback": {
      "is_playing": true,
      "active_track_index": 0,
      "last_action": null
    }
  }
}
```

## Spotify Connect

- `POST /integrations/spotify/connect`

Request in local mock mode:

```json
{
  "project_id": "proj_123"
}
```

Response in local mock mode:

```json
{
  "provider": "spotify",
  "project_id": "proj_123",
  "status": "connected",
  "mode": "mock",
  "available_actions": ["next_track", "previous_track", "play_pause"],
  "connection": {
    "connected": true,
    "connected_at": "2026-03-19T10:00:00.000Z",
    "updated_at": "2026-03-19T10:00:00.000Z",
    "scopes": ["user-modify-playback-state", "user-read-playback-state"],
    "account": {
      "id": "mock-user",
      "display_name": "Local Mock Spotify",
      "product": "dev"
    },
    "mock_playback": {
      "is_playing": true,
      "active_track_index": 0,
      "last_action": null
    }
  }
}
```

Request when real Spotify credentials are configured:

```json
{
  "project_id": "proj_123",
  "redirect_uri": "http://localhost:4000/api/v1/integrations/spotify/callback",
  "state": "opaque_state_from_orchestrator"
}
```

Response when real Spotify credentials are configured:

```json
{
  "provider": "spotify",
  "project_id": "proj_123",
  "status": "authorization_required",
  "mode": "oauth",
  "authorization_url": "https://accounts.spotify.com/authorize?...",
  "state": "opaque_state_from_orchestrator",
  "available_actions": ["next_track", "previous_track", "play_pause"],
  "connection": {
    "connected": false
  }
}
```

## Spotify Callback

- `GET /integrations/spotify/callback?project_id=proj_123&code=auth_code&state=opaque_state_from_orchestrator`

Response:

```json
{
  "provider": "spotify",
  "project_id": "proj_123",
  "status": "connected",
  "mode": "oauth",
  "available_actions": ["next_track", "previous_track", "play_pause"],
  "connection": {
    "connected": true,
    "connected_at": "2026-03-19T10:00:00.000Z",
    "updated_at": "2026-03-19T10:00:00.000Z",
    "scopes": ["user-modify-playback-state", "user-read-playback-state"],
    "account": {
      "id": "spotify_user",
      "display_name": "Spotify User",
      "product": "premium"
    }
  }
}
```

## Spotify Action

- `POST /integrations/spotify/action`

Request:

```json
{
  "project_id": "proj_123",
  "node_id": "node_spotify",
  "action": "next_track",
  "idempotency_key": "pkt_123"
}
```

Response:

```json
{
  "status": "ok",
  "provider": "spotify",
  "project_id": "proj_123",
  "node_id": "node_spotify",
  "action": "next_track",
  "mode": "mock",
  "idempotency": {
    "key": "pkt_123",
    "replayed": false
  },
  "result": {
    "connection_status": "connected",
    "playback": {
      "is_playing": true,
      "active_track_index": 1,
      "last_action": "next_track"
    }
  }
}
```

Replay response for the same `idempotency_key` and request body:

```json
{
  "status": "ok",
  "provider": "spotify",
  "project_id": "proj_123",
  "node_id": "node_spotify",
  "action": "next_track",
  "mode": "mock",
  "idempotency": {
    "key": "pkt_123",
    "replayed": true
  },
  "result": {
    "connection_status": "connected",
    "playback": {
      "is_playing": true,
      "active_track_index": 1,
      "last_action": "next_track"
    }
  }
}
```

Notes:

- Supported actions are `next_track`, `previous_track`, and `play_pause`.
- When `SPOTIFY_CLIENT_ID` and `SPOTIFY_CLIENT_SECRET` are absent, the execution engine uses a local mock connection and stores mock playback state in the token vault.
- When real credentials are present, the execution engine returns an authorization URL, stores tokens only in the execution engine token vault, refreshes access tokens server-side, and never returns tokens to callers.
- Idempotency is enforced per `project_id` and `idempotency_key`. Reusing the same key with a different action or node is rejected with `idempotency_conflict`.
- The orchestrator persists the response object in `Consumer.Spotify` runtime history so future action/auth status fields can surface in the canonical graph without a websocket envelope change.

## Error Shape

```json
{
  "code": "training_failed",
  "message": "Model training failed",
  "details": {}
}
```
