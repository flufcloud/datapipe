import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { createApp } from "../src/app.js";
import { createInMemoryTokenVault } from "../src/integrations/token-vault.js";

describe("execution-engine API", () => {
  /** @type {import('express').Express} */
  let app;
  let trainedModelId;

  before(() => {
    app = createApp({
      tokenVault: createInMemoryTokenVault(),
    });
  });

  it("GET /health returns contract shape", async () => {
    const res = await request(app).get("/health").expect(200);
    assert.deepEqual(res.body, { status: "ok" });
  });

  it("POST /api/v1/classifier/train accepts contract body and returns queued job", async () => {
    const body = {
      project_id: "proj_123",
      node_id: "node_classifier",
      dataset: {
        labels: ["clockwise", "counterclockwise"],
        samples: [],
      },
      config: {
        window_size: 30,
        epochs: 20,
      },
    };
    const res = await request(app)
      .post("/api/v1/classifier/train")
      .send(body)
      .expect(200);

    assert.match(res.body.job_id, /^job_[0-9a-f-]{36}$/);
    assert.equal(res.body.status, "queued");

    const running = await request(app).get(`/api/v1/jobs/${res.body.job_id}`).expect(200);
    assert.equal(running.body.status, "running");

    const completed = await request(app).get(`/api/v1/jobs/${res.body.job_id}`).expect(200);
    assert.equal(completed.body.status, "completed");
    assert.match(completed.body.result.model_id, /^model_[0-9a-f-]{36}$/);
    trainedModelId = completed.body.result.model_id;
  });

  it("POST /api/v1/classifier/train rejects incomplete body with error contract", async () => {
    const res = await request(app)
      .post("/api/v1/classifier/train")
      .send({ project_id: "p" })
      .expect(400);

    assert.equal(res.body.code, "invalid_request");
    assert.equal(res.body.message, "Invalid train request");
    assert.deepEqual(res.body.details.fields, [
      "node_id must be a non-empty string",
      "dataset must be an object",
      "config must be an object",
    ]);
  });

  it("POST /api/v1/classifier/train rejects invalid dataset fields", async () => {
    const res = await request(app)
      .post("/api/v1/classifier/train")
      .send({
        project_id: "proj_123",
        node_id: "node_classifier",
        dataset: {
          labels: ["clockwise", ""],
        },
        config: {},
      })
      .expect(400);

    assert.deepEqual(res.body.details.fields, [
      "dataset.labels must contain non-empty strings",
      "dataset.samples must be an array",
    ]);
  });

  it("POST /api/v1/classifier/infer returns contract shape", async () => {
    assert.ok(trainedModelId, "expected a trained model from the training test");

    const res = await request(app)
      .post("/api/v1/classifier/infer")
      .send({
        project_id: "proj_123",
        node_id: "node_classifier",
        model_id: trainedModelId,
        vector_window: [
          { x: 0.2, y: 0.1, z: 0.7 },
          { x: 0.4, y: -0.1, z: 0.6 },
        ],
      })
      .expect(200);

    assert.equal(res.body.label, "clockwise");
    assert.ok(res.body.confidence >= 0.65);
  });

  it("POST /api/v1/classifier/infer rejects invalid body with error contract", async () => {
    const res = await request(app)
      .post("/api/v1/classifier/infer")
      .send({ project_id: "proj_123" })
      .expect(400);

    assert.equal(res.body.code, "invalid_request");
    assert.ok(Array.isArray(res.body.details.fields));
  });

  it("POST /api/v1/fusion/infer returns a fused label when the rule matches", async () => {
    const res = await request(app)
      .post("/api/v1/fusion/infer")
      .send({
        project_id: "proj_123",
        node_id: "node_fusion",
        inputs: {
          left: { label: "clockwise", confidence: 0.91, source_node_id: "node_gesture" },
          right: { label: "active", confidence: 0.82, source_node_id: "node_context" },
        },
        config: {
          rules: [
            {
              left_label: "clockwise",
              right_label: "active",
              output_label: "music_control",
              confidence: 0.97,
            },
          ],
        },
      })
      .expect(200);

    assert.equal(res.body.matched, true);
    assert.equal(res.body.label, "music_control");
    assert.equal(res.body.confidence, 0.97);
    assert.deepEqual(res.body.matched_rule, {
      left_label: "clockwise",
      right_label: "active",
      output_label: "music_control",
    });
  });

  it("POST /api/v1/fusion/infer reports no match without failing the request", async () => {
    const res = await request(app)
      .post("/api/v1/fusion/infer")
      .send({
        project_id: "proj_123",
        node_id: "node_fusion",
        inputs: {
          left: { label: "counterclockwise", confidence: 0.61 },
          right: { label: "idle", confidence: 0.7 },
        },
        config: {
          rules: [
            {
              left_label: "clockwise",
              right_label: "active",
              output_label: "music_control",
            },
          ],
        },
      })
      .expect(200);

    assert.equal(res.body.matched, false);
    assert.equal(res.body.reason, "no_rule_match");
  });

  it("POST /api/v1/fusion/infer rejects invalid bodies with a structured error", async () => {
    const res = await request(app)
      .post("/api/v1/fusion/infer")
      .send({
        project_id: "proj_123",
        node_id: "node_fusion",
        inputs: {
          left: { label: "" },
        },
        config: {
          rules: {},
        },
      })
      .expect(400);

    assert.equal(res.body.code, "invalid_request");
    assert.deepEqual(res.body.details.fields, [
      "inputs.left.label must be a non-empty string",
      "config.rules must be an array",
    ]);
  });

  it("GET /api/v1/integrations/spotify/auth-state returns disconnected mock state", async () => {
    const res = await request(app)
      .get("/api/v1/integrations/spotify/auth-state")
      .query({ project_id: "proj_123" })
      .expect(200);

    assert.equal(res.body.provider, "spotify");
    assert.equal(res.body.project_id, "proj_123");
    assert.equal(res.body.status, "not_connected");
    assert.equal(res.body.mode, "mock");
    assert.deepEqual(res.body.connection, { connected: false });
  });

  it("POST /api/v1/integrations/spotify/connect creates a mock connection", async () => {
    const res = await request(app)
      .post("/api/v1/integrations/spotify/connect")
      .send({
        project_id: "proj_123",
      })
      .expect(200);

    assert.equal(res.body.provider, "spotify");
    assert.equal(res.body.status, "connected");
    assert.equal(res.body.mode, "mock");
    assert.equal(res.body.connection.connected, true);
    assert.equal(res.body.connection.account.display_name, "Local Mock Spotify");

    const state = await request(app)
      .get("/api/v1/integrations/spotify/auth-state")
      .query({ project_id: "proj_123" })
      .expect(200);

    assert.equal(state.body.status, "connected");
    assert.equal(state.body.connection.mock_playback.active_track_index, 0);
    assert.equal(state.body.connection.mock_playback.is_playing, true);
  });

  it("OAuth-mode auth-state preserves pending authorization details", async () => {
    const oauthApp = createApp({
      env: {
        ...process.env,
        SPOTIFY_CLIENT_ID: "client_id",
        SPOTIFY_CLIENT_SECRET: "client_secret",
      },
      tokenVault: createInMemoryTokenVault(),
    });

    const connect = await request(oauthApp)
      .post("/api/v1/integrations/spotify/connect")
      .send({
        project_id: "proj_oauth",
        redirect_uri: "http://localhost:4000/api/v1/integrations/spotify/callback",
      })
      .expect(200);

    assert.equal(connect.body.status, "authorization_required");
    assert.ok(typeof connect.body.authorization_url === "string");
    assert.ok(typeof connect.body.state === "string");

    const state = await request(oauthApp)
      .get("/api/v1/integrations/spotify/auth-state")
      .query({ project_id: "proj_oauth" })
      .expect(200);

    assert.equal(state.body.status, "authorization_required");
    assert.equal(state.body.authorization_url, connect.body.authorization_url);
    assert.equal(state.body.state, connect.body.state);
  });

  it("POST /api/v1/integrations/spotify/action executes once per idempotency key", async () => {
    const res = await request(app)
      .post("/api/v1/integrations/spotify/action")
      .send({
        project_id: "proj_123",
        node_id: "node_spotify",
        action: "next_track",
        idempotency_key: "pkt_123",
      })
      .expect(200);

    assert.equal(res.body.status, "ok");
    assert.equal(res.body.provider, "spotify");
    assert.equal(res.body.mode, "mock");
    assert.equal(res.body.idempotency.replayed, false);
    assert.equal(res.body.result.playback.active_track_index, 1);
    assert.equal(res.body.result.playback.last_action, "next_track");

    const replay = await request(app)
      .post("/api/v1/integrations/spotify/action")
      .send({
        project_id: "proj_123",
        node_id: "node_spotify",
        action: "next_track",
        idempotency_key: "pkt_123",
      })
      .expect(200);

    assert.equal(replay.body.idempotency.replayed, true);
    assert.equal(replay.body.result.playback.active_track_index, 1);

    const state = await request(app)
      .get("/api/v1/integrations/spotify/auth-state")
      .query({ project_id: "proj_123" })
      .expect(200);

    assert.equal(state.body.connection.mock_playback.active_track_index, 1);
  });

  it("POST /api/v1/integrations/spotify/action rejects conflicting idempotency reuse", async () => {
    const res = await request(app)
      .post("/api/v1/integrations/spotify/action")
      .send({
        project_id: "proj_123",
        node_id: "node_spotify",
        action: "previous_track",
        idempotency_key: "pkt_123",
      })
      .expect(409);

    assert.equal(res.body.code, "idempotency_conflict");
  });

  it("POST /api/v1/integrations/spotify/action returns integration_not_connected when auth is missing", async () => {
    const disconnectedApp = createApp({
      tokenVault: createInMemoryTokenVault(),
    });

    const res = await request(disconnectedApp)
      .post("/api/v1/integrations/spotify/action")
      .send({
        project_id: "proj_999",
        node_id: "node_spotify",
        action: "play_pause",
        idempotency_key: "pkt_missing_connection",
      })
      .expect(409);

    assert.equal(res.body.code, "integration_not_connected");
  });

  it("Spotify endpoints reject invalid requests with structured errors", async () => {
    const invalidAction = await request(app)
      .post("/api/v1/integrations/spotify/action")
      .send({
        project_id: "proj_123",
        node_id: "node_spotify",
        action: "shuffle",
        idempotency_key: "pkt_invalid",
      })
      .expect(400);

    assert.equal(invalidAction.body.code, "invalid_request");
    assert.deepEqual(invalidAction.body.details.fields, [
      "action must be one of: next_track, previous_track, play_pause",
    ]);

    const invalidAuthState = await request(app)
      .get("/api/v1/integrations/spotify/auth-state")
      .expect(400);

    assert.equal(invalidAuthState.body.code, "invalid_request");
    assert.deepEqual(invalidAuthState.body.details.fields, [
      "project_id must be a non-empty string",
    ]);
  });

  it("GET /api/v1/jobs/:job_id returns 404 for missing jobs", async () => {
    const res = await request(app).get("/api/v1/jobs/job_missing").expect(404);
    assert.equal(res.body.code, "job_not_found");
  });

  it("returns structured JSON for malformed request bodies", async () => {
    const res = await request(app)
      .post("/api/v1/classifier/infer")
      .set("content-type", "application/json")
      .send('{"project_id":"proj_123"')
      .expect(400);

    assert.deepEqual(res.body, {
      code: "invalid_request",
      message: "Malformed JSON body",
      details: {},
    });
  });
});
