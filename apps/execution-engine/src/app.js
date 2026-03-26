import express from "express";
import { randomUUID } from "node:crypto";
import { createSpotifyAdapter, isSupportedSpotifyAction } from "./integrations/spotify-adapter.js";
import { createLocalTokenVault } from "./integrations/token-vault.js";

const API_PREFIX = "/api/v1";

function errorBody(code, message, details = {}) {
  return { code, message, details };
}

function requireString(obj, field, path = field) {
  const v = obj?.[field];
  if (typeof v !== "string" || v.length === 0) {
    return `${path} must be a non-empty string`;
  }
  return null;
}

function requireObject(obj, field, path = field) {
  const v = obj?.[field];
  if (v === null || typeof v !== "object" || Array.isArray(v)) {
    return `${path} must be an object`;
  }
  return null;
}

function requireArray(obj, field, path = field) {
  const v = obj?.[field];
  if (!Array.isArray(v)) {
    return `${path} must be an array`;
  }
  return null;
}

function requireStringArray(obj, field, path = field) {
  const value = obj?.[field];
  if (!Array.isArray(value)) {
    return `${path} must be an array`;
  }
  if (value.some((entry) => typeof entry !== "string" || entry.length === 0)) {
    return `${path} must contain non-empty strings`;
  }
  return null;
}

function validateTrainRequest(body) {
  const errors = [
    requireString(body, "project_id"),
    requireString(body, "node_id"),
    requireObject(body, "dataset"),
    requireObject(body, "config"),
  ].filter(Boolean);

  if (body?.dataset && typeof body.dataset === "object" && !Array.isArray(body.dataset)) {
    const datasetErrors = [
      requireStringArray(body.dataset, "labels", "dataset.labels"),
      requireArray(body.dataset, "samples", "dataset.samples"),
    ].filter(Boolean);
    errors.push(...datasetErrors);
  }

  return errors;
}

function validateInferRequest(body) {
  return [
    requireString(body, "project_id"),
    requireString(body, "node_id"),
    requireString(body, "model_id"),
    requireArray(body, "vector_window"),
  ].filter(Boolean);
}

function validateFusionRequest(body) {
  const errors = [
    requireString(body, "project_id"),
    requireString(body, "node_id"),
    requireObject(body, "inputs"),
    requireObject(body, "config"),
  ].filter(Boolean);

  if (body?.inputs && typeof body.inputs === "object" && !Array.isArray(body.inputs)) {
    for (const [port, input] of Object.entries(body.inputs)) {
      if (input === null || typeof input !== "object" || Array.isArray(input)) {
        errors.push(`inputs.${port} must be an object`);
        continue;
      }

      if (typeof input.label !== "string" || input.label.length === 0) {
        errors.push(`inputs.${port}.label must be a non-empty string`);
      }

      if (input.confidence !== undefined && typeof input.confidence !== "number") {
        errors.push(`inputs.${port}.confidence must be a number when provided`);
      }
    }
  }

  if (body?.config && typeof body.config === "object" && !Array.isArray(body.config)) {
    if (!Array.isArray(body.config.rules)) {
      errors.push("config.rules must be an array");
    } else {
      for (const [index, rule] of body.config.rules.entries()) {
        if (rule === null || typeof rule !== "object" || Array.isArray(rule)) {
          errors.push(`config.rules[${index}] must be an object`);
          continue;
        }

        if (typeof rule.left_label !== "string" || rule.left_label.length === 0) {
          errors.push(`config.rules[${index}].left_label must be a non-empty string`);
        }

        if (typeof rule.right_label !== "string" || rule.right_label.length === 0) {
          errors.push(`config.rules[${index}].right_label must be a non-empty string`);
        }

        if (typeof rule.output_label !== "string" || rule.output_label.length === 0) {
          errors.push(`config.rules[${index}].output_label must be a non-empty string`);
        }

        if (rule.confidence !== undefined && typeof rule.confidence !== "number") {
          errors.push(`config.rules[${index}].confidence must be a number when provided`);
        }
      }
    }
  }

  return errors;
}

function validateSpotifyActionRequest(body) {
  const errors = [
    requireString(body, "project_id"),
    requireString(body, "node_id"),
    requireString(body, "action"),
    requireString(body, "idempotency_key"),
  ].filter(Boolean);

  if (typeof body?.action === "string" && !isSupportedSpotifyAction(body.action)) {
    errors.push("action must be one of: next_track, previous_track, play_pause");
  }

  return errors;
}

function validateSpotifyConnectRequest(body, requiresRedirectUri) {
  const errors = [requireString(body, "project_id")].filter(Boolean);

  if (requiresRedirectUri) {
    errors.push(requireString(body, "redirect_uri"));
  }

  if (body?.state !== undefined && typeof body.state !== "string") {
    errors.push("state must be a string when provided");
  }

  return errors.filter(Boolean);
}

function validateSpotifyCallbackQuery(query) {
  return [
    requireString(query, "project_id"),
    requireString(query, "code"),
    requireString(query, "state"),
  ].filter(Boolean);
}

function createRuntimeStore() {
  return {
    jobs: new Map(),
    models: new Map(),
    spotifyActions: new Map(),
    spotifyAuthStates: new Map(),
  };
}

function startTrainingJob(store, body) {
  const job_id = `job_${randomUUID()}`;
  const model_id = `model_${randomUUID()}`;

  store.jobs.set(job_id, {
    job_id,
    status: "queued",
    progress: 0,
    polls: 0,
    project_id: body.project_id,
    node_id: body.node_id,
    result: {
      model_id,
      labels: body.dataset.labels,
      window_size: Number(body.config.window_size) || 8,
      epochs: Number(body.config.epochs) || 20,
    },
  });

  return {
    job_id,
    status: "queued",
  };
}

function getJobStatus(store, job_id) {
  const job = store.jobs.get(job_id);
  if (!job) {
    return null;
  }

  job.polls += 1;

  if (job.polls >= 2) {
    job.status = "completed";
    job.progress = 100;
    store.models.set(job.result.model_id, {
      model_id: job.result.model_id,
      labels: job.result.labels,
      window_size: job.result.window_size,
      epochs: job.result.epochs,
    });
  } else {
    job.status = "running";
    job.progress = 50;
  }

  return {
    job_id: job.job_id,
    status: job.status,
    progress: job.progress,
    ...(job.status === "completed" ? { result: job.result } : {}),
  };
}

function inferLabel(store, body) {
  const model = store.models.get(body.model_id);
  if (!model) {
    return { error: errorBody("model_not_found", "Unknown model_id", { model_id: body.model_id }) };
  }

  const xs = body.vector_window.map((entry) => Number(entry?.x ?? 0));
  const avgX = xs.length ? xs.reduce((sum, value) => sum + value, 0) / xs.length : 0;
  const [positiveLabel = "clockwise", negativeLabel = positiveLabel] = model.labels;
  const label = avgX >= 0 ? positiveLabel : negativeLabel;
  const confidence = Math.min(0.99, 0.65 + Math.abs(avgX));

  return {
    label,
    confidence: Number(confidence.toFixed(2)),
  };
}

function inferFusion(body) {
  const left = body.inputs?.left;
  const right = body.inputs?.right;
  const rules = Array.isArray(body.config?.rules) ? body.config.rules : [];
  const matchedRule = rules.find(
    (rule) => rule.left_label === left?.label && rule.right_label === right?.label
  );

  if (!matchedRule) {
    return {
      matched: false,
      reason: "no_rule_match",
    };
  }

  const leftConfidence = typeof left?.confidence === "number" ? left.confidence : 0.75;
  const rightConfidence = typeof right?.confidence === "number" ? right.confidence : 0.75;
  const derivedConfidence =
    typeof matchedRule.confidence === "number"
      ? matchedRule.confidence
      : Number(((leftConfidence + rightConfidence) / 2).toFixed(2));

  return {
    matched: true,
    label: matchedRule.output_label,
    confidence: Number(Math.max(0, Math.min(0.99, derivedConfidence)).toFixed(2)),
    matched_rule: {
      left_label: matchedRule.left_label,
      right_label: matchedRule.right_label,
      output_label: matchedRule.output_label,
    },
    inputs: [
      {
        port: "left",
        label: left.label,
        confidence: leftConfidence,
        source_node_id: left.source_node_id ?? null,
      },
      {
        port: "right",
        label: right.label,
        confidence: rightConfidence,
        source_node_id: right.source_node_id ?? null,
      },
    ],
  };
}

function asyncRoute(handler) {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

export function createApp({
  env = process.env,
  tokenVault = createLocalTokenVault({
    filePath: env.DATAPIPE_TOKEN_VAULT_PATH,
  }),
} = {}) {
  const store = createRuntimeStore();
  const spotify = createSpotifyAdapter({
    tokenVault,
    actionExecutions: store.spotifyActions,
    pendingAuthorizations: store.spotifyAuthStates,
    env,
  });
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "1mb" }));

  app.get("/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  app.post(`${API_PREFIX}/classifier/train`, (req, res) => {
    const body = req.body ?? {};
    const errs = validateTrainRequest(body);

    if (errs.length) {
      return res.status(400).json(
        errorBody("invalid_request", "Invalid train request", { fields: errs })
      );
    }

    res.status(200).json(startTrainingJob(store, body));
  });

  app.get(`${API_PREFIX}/jobs/:job_id`, (req, res) => {
    const status = getJobStatus(store, req.params.job_id);
    if (!status) {
      return res
        .status(404)
        .json(errorBody("job_not_found", "Unknown job_id", { job_id: req.params.job_id }));
    }

    return res.status(200).json(status);
  });

  app.post(`${API_PREFIX}/classifier/infer`, (req, res) => {
    const body = req.body ?? {};
    const errs = validateInferRequest(body);

    if (errs.length) {
      return res.status(400).json(
        errorBody("invalid_request", "Invalid infer request", { fields: errs })
      );
    }

    const result = inferLabel(store, body);
    if ("error" in result) {
      return res.status(404).json(result.error);
    }

    res.status(200).json(result);
  });

  app.post(`${API_PREFIX}/fusion/infer`, (req, res) => {
    const body = req.body ?? {};
    const errs = validateFusionRequest(body);

    if (errs.length) {
      return res.status(400).json(
        errorBody("invalid_request", "Invalid fusion request", { fields: errs })
      );
    }

    res.status(200).json(inferFusion(body));
  });

  app.get(
    `${API_PREFIX}/integrations/spotify/auth-state`,
    asyncRoute(async (req, res) => {
      const projectIdError = requireString(req.query, "project_id");
      if (projectIdError) {
        return res.status(400).json(
          errorBody("invalid_request", "Invalid Spotify auth-state request", {
            fields: [projectIdError],
          })
        );
      }

      const response = await spotify.getAuthState(String(req.query.project_id));
      return res.status(response.statusCode).json(response.body);
    })
  );

  app.post(
    `${API_PREFIX}/integrations/spotify/connect`,
    asyncRoute(async (req, res) => {
      const body = req.body ?? {};
      const errs = validateSpotifyConnectRequest(body, Boolean(env.SPOTIFY_CLIENT_ID && env.SPOTIFY_CLIENT_SECRET));

      if (errs.length) {
        return res.status(400).json(
          errorBody("invalid_request", "Invalid Spotify connect request", {
            fields: errs,
          })
        );
      }

      const response = await spotify.connect(body);
      return res.status(response.statusCode).json(response.body);
    })
  );

  app.get(
    `${API_PREFIX}/integrations/spotify/callback`,
    asyncRoute(async (req, res) => {
      const errs = validateSpotifyCallbackQuery(req.query);
      if (errs.length) {
        return res.status(400).json(
          errorBody("invalid_request", "Invalid Spotify callback request", {
            fields: errs,
          })
        );
      }

      const response = await spotify.handleCallback({
        project_id: String(req.query.project_id),
        code: String(req.query.code),
        state: String(req.query.state),
        redirect_uri:
          typeof req.query.redirect_uri === "string" ? String(req.query.redirect_uri) : undefined,
      });
      return res.status(response.statusCode).json(response.body);
    })
  );

  app.post(`${API_PREFIX}/integrations/spotify/action`, asyncRoute(async (req, res) => {
    const body = req.body ?? {};
    const errs = validateSpotifyActionRequest(body);

    if (errs.length) {
      return res.status(400).json(
        errorBody("invalid_request", "Invalid Spotify action request", {
          fields: errs,
        })
      );
    }

    const response = await spotify.runAction(body);
    return res.status(response.statusCode).json(response.body);
  }));

  app.use((err, _req, res, next) => {
    if (err instanceof SyntaxError && "body" in err) {
      return res
        .status(400)
        .json(errorBody("invalid_request", "Malformed JSON body", {}));
    }
    return next(err);
  });

  app.use((req, res) => {
    res.status(404).json(
      errorBody("not_found", "No route for this path", { path: req.path })
    );
  });

  return app;
}
