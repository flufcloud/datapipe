import { Buffer } from "node:buffer";
import { randomUUID } from "node:crypto";

const SPOTIFY_PROVIDER = "spotify";
const SPOTIFY_SCOPES = ["user-modify-playback-state", "user-read-playback-state"];
const SUPPORTED_ACTIONS = ["next_track", "previous_track", "play_pause"];

function errorResult(statusCode, code, message, details = {}) {
  return {
    ok: false,
    statusCode,
    body: {
      code,
      message,
      details,
    },
  };
}

function successResult(statusCode, body) {
  return {
    ok: true,
    statusCode,
    body,
  };
}

function hasRealSpotifyCredentials(env) {
  return Boolean(env.SPOTIFY_CLIENT_ID && env.SPOTIFY_CLIENT_SECRET);
}

function createMockPlaybackState() {
  return {
    is_playing: true,
    active_track_index: 0,
    last_action: null,
  };
}

function toConnectionSummary(connection) {
  if (!connection) {
    return { connected: false };
  }

  return {
    connected: true,
    connected_at: connection.connected_at,
    updated_at: connection.updated_at,
    scopes: connection.scopes,
    account: connection.account,
    mock_playback:
      connection.mode === "mock"
        ? {
            is_playing: connection.mock_playback?.is_playing ?? false,
            active_track_index: connection.mock_playback?.active_track_index ?? 0,
            last_action: connection.mock_playback?.last_action ?? null,
          }
        : undefined,
  };
}

function buildStateKey(projectId, state) {
  return `${projectId}:${state}`;
}

function getPendingAuthorizationForProject(pendingAuthorizations, projectId) {
  for (const pending of pendingAuthorizations.values()) {
    if (pending?.project_id === projectId) {
      return pending;
    }
  }

  return null;
}

function buildIdempotencyFingerprint(request) {
  return JSON.stringify({
    project_id: request.project_id,
    node_id: request.node_id,
    action: request.action,
  });
}

function buildActionResponse(request, mode, execution, replayed = false) {
  return {
    status: "ok",
    provider: SPOTIFY_PROVIDER,
    project_id: request.project_id,
    node_id: request.node_id,
    action: request.action,
    mode,
    idempotency: {
      key: request.idempotency_key,
      replayed,
    },
    result: execution,
  };
}

export function isSupportedSpotifyAction(action) {
  return SUPPORTED_ACTIONS.includes(action);
}

export function createSpotifyAdapter({
  tokenVault,
  actionExecutions,
  pendingAuthorizations,
  env = process.env,
  fetchImpl = globalThis.fetch,
  now = () => Date.now(),
} = {}) {
  if (!tokenVault) {
    throw new Error("tokenVault is required");
  }
  if (!actionExecutions) {
    throw new Error("actionExecutions map is required");
  }
  if (!pendingAuthorizations) {
    throw new Error("pendingAuthorizations map is required");
  }
  if (typeof fetchImpl !== "function") {
    throw new Error("fetch implementation is required");
  }

  async function readConnection(projectId) {
    return tokenVault.getConnection(SPOTIFY_PROVIDER, projectId);
  }

  async function writeConnection(projectId, connection) {
    return tokenVault.setConnection(SPOTIFY_PROVIDER, projectId, connection);
  }

  function getMode() {
    return hasRealSpotifyCredentials(env) ? "oauth" : "mock";
  }

  async function getAuthState(projectId) {
    const connection = await readConnection(projectId);
    const pendingAuthorization = connection ? null : getPendingAuthorizationForProject(pendingAuthorizations, projectId);

    if (pendingAuthorization) {
      return successResult(200, {
        provider: SPOTIFY_PROVIDER,
        project_id: projectId,
        status: "authorization_required",
        mode: getMode(),
        available_actions: SUPPORTED_ACTIONS,
        authorization_url: pendingAuthorization.authorization_url,
        state: pendingAuthorization.state,
        connection: { connected: false },
      });
    }

    return successResult(200, {
      provider: SPOTIFY_PROVIDER,
      project_id: projectId,
      status: connection ? "connected" : "not_connected",
      mode: getMode(),
      available_actions: SUPPORTED_ACTIONS,
      connection: toConnectionSummary(connection),
    });
  }

  async function connect({ project_id, redirect_uri, state }) {
    if (getMode() === "mock") {
      const timestamp = new Date(now()).toISOString();
      const connection = {
        provider: SPOTIFY_PROVIDER,
        mode: "mock",
        connected_at: timestamp,
        updated_at: timestamp,
        scopes: SPOTIFY_SCOPES,
        account: {
          id: "mock-user",
          display_name: "Local Mock Spotify",
          product: "dev",
        },
        tokens: null,
        mock_playback: createMockPlaybackState(),
      };

      await writeConnection(project_id, connection);

      return successResult(200, {
        provider: SPOTIFY_PROVIDER,
        project_id,
        status: "connected",
        mode: "mock",
        available_actions: SUPPORTED_ACTIONS,
        connection: toConnectionSummary(connection),
      });
    }

    if (!redirect_uri) {
      return errorResult(400, "invalid_request", "Invalid Spotify connect request", {
        fields: ["redirect_uri must be a non-empty string"],
      });
    }

    const resolvedState = state || `spotify_${randomUUID()}`;
    const params = new URLSearchParams({
      client_id: env.SPOTIFY_CLIENT_ID,
      response_type: "code",
      redirect_uri,
      scope: SPOTIFY_SCOPES.join(" "),
      state: resolvedState,
    });
    const authorization_url = `https://accounts.spotify.com/authorize?${params.toString()}`;

    pendingAuthorizations.set(buildStateKey(project_id, resolvedState), {
      project_id,
      redirect_uri,
      state: resolvedState,
      authorization_url,
      created_at: new Date(now()).toISOString(),
    });

    return successResult(200, {
      provider: SPOTIFY_PROVIDER,
      project_id,
      status: "authorization_required",
      mode: "oauth",
      authorization_url,
      state: resolvedState,
      available_actions: SUPPORTED_ACTIONS,
      connection: { connected: false },
    });
  }

  async function spotifyTokenRequest(params) {
    const basicAuth = Buffer.from(
      `${env.SPOTIFY_CLIENT_ID}:${env.SPOTIFY_CLIENT_SECRET}`,
      "utf8"
    ).toString("base64");

    const response = await fetchImpl("https://accounts.spotify.com/api/token", {
      method: "POST",
      headers: {
        authorization: `Basic ${basicAuth}`,
        "content-type": "application/x-www-form-urlencoded",
      },
      body: params.toString(),
    });

    const json = await response.json().catch(() => ({}));
    if (!response.ok) {
      return errorResult(502, "spotify_auth_failed", "Spotify token exchange failed", {
        spotify_status: response.status,
        spotify_error: json.error ?? null,
        spotify_error_description: json.error_description ?? null,
      });
    }

    return successResult(200, json);
  }

  async function fetchSpotifyProfile(accessToken) {
    const response = await fetchImpl("https://api.spotify.com/v1/me", {
      headers: {
        authorization: `Bearer ${accessToken}`,
      },
    });

    const json = await response.json().catch(() => ({}));
    if (!response.ok) {
      return null;
    }

    return {
      id: json.id ?? "spotify-user",
      display_name: json.display_name ?? json.id ?? "Spotify User",
      product: json.product ?? null,
    };
  }

  async function handleCallback({ project_id, code, state, redirect_uri }) {
    if (getMode() === "mock") {
      return errorResult(
        409,
        "spotify_mock_mode",
        "Spotify callback is not used when credentials are absent",
        { project_id }
      );
    }

    const pending = state ? pendingAuthorizations.get(buildStateKey(project_id, state)) : null;
    if (!pending) {
      return errorResult(400, "invalid_request", "Unknown or expired Spotify authorization state", {
        project_id,
        state: state ?? null,
      });
    }

    const resolvedRedirectUri = redirect_uri || pending.redirect_uri || env.SPOTIFY_REDIRECT_URI;
    if (!resolvedRedirectUri) {
      return errorResult(400, "invalid_request", "Spotify redirect_uri is required", {
        fields: ["redirect_uri must be a non-empty string"],
      });
    }

    const tokenResponse = await spotifyTokenRequest(
      new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: resolvedRedirectUri,
      })
    );
    if (!tokenResponse.ok) {
      return tokenResponse;
    }

    const tokenBody = tokenResponse.body;
    const timestamp = now();
    const connection = {
      provider: SPOTIFY_PROVIDER,
      mode: "oauth",
      connected_at: new Date(timestamp).toISOString(),
      updated_at: new Date(timestamp).toISOString(),
      scopes: (tokenBody.scope ?? SPOTIFY_SCOPES.join(" ")).split(" ").filter(Boolean),
      account: await fetchSpotifyProfile(tokenBody.access_token),
      tokens: {
        access_token: tokenBody.access_token,
        refresh_token: tokenBody.refresh_token ?? null,
        token_type: tokenBody.token_type ?? "Bearer",
        expires_at: timestamp + Number(tokenBody.expires_in ?? 3600) * 1000,
      },
      mock_playback: null,
    };

    pendingAuthorizations.delete(buildStateKey(project_id, state));
    await writeConnection(project_id, connection);

    return successResult(200, {
      provider: SPOTIFY_PROVIDER,
      project_id,
      status: "connected",
      mode: "oauth",
      available_actions: SUPPORTED_ACTIONS,
      connection: toConnectionSummary(connection),
    });
  }

  async function refreshConnectionIfNeeded(projectId, connection) {
    if (connection.mode !== "oauth") {
      return successResult(200, connection);
    }

    if (!connection.tokens?.access_token) {
      return errorResult(409, "integration_not_connected", "Spotify access token is unavailable", {
        project_id: projectId,
      });
    }

    const expiresAt = Number(connection.tokens.expires_at ?? 0);
    if (expiresAt > now() + 30_000) {
      return successResult(200, connection);
    }

    if (!connection.tokens.refresh_token) {
      return errorResult(409, "integration_not_connected", "Spotify refresh token is unavailable", {
        project_id: projectId,
      });
    }

    const refreshResponse = await spotifyTokenRequest(
      new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: connection.tokens.refresh_token,
      })
    );
    if (!refreshResponse.ok) {
      return refreshResponse;
    }

    const tokenBody = refreshResponse.body;
    const refreshed = {
      ...connection,
      updated_at: new Date(now()).toISOString(),
      scopes: (tokenBody.scope ?? connection.scopes.join(" ")).split(" ").filter(Boolean),
      tokens: {
        access_token: tokenBody.access_token,
        refresh_token: tokenBody.refresh_token ?? connection.tokens.refresh_token,
        token_type: tokenBody.token_type ?? connection.tokens.token_type ?? "Bearer",
        expires_at: now() + Number(tokenBody.expires_in ?? 3600) * 1000,
      },
    };

    await writeConnection(projectId, refreshed);
    return successResult(200, refreshed);
  }

  async function performSpotifyRequest(connection, method, pathname) {
    const response = await fetchImpl(`https://api.spotify.com/v1${pathname}`, {
      method,
      headers: {
        authorization: `Bearer ${connection.tokens.access_token}`,
      },
    });

    if (response.status === 204) {
      return successResult(204, null);
    }

    const json = await response.json().catch(() => ({}));
    if (!response.ok) {
      return errorResult(502, "spotify_action_failed", "Spotify action request failed", {
        spotify_status: response.status,
        spotify_error: json.error?.message ?? json.error ?? null,
        pathname,
      });
    }

    return successResult(response.status, json);
  }

  async function executeRealAction(request, connection) {
    if (request.action === "next_track") {
      const response = await performSpotifyRequest(connection, "POST", "/me/player/next");
      if (!response.ok) {
        return response;
      }
      return successResult(200, {
        connection_status: "connected",
        playback: { acknowledged: true },
      });
    }

    if (request.action === "previous_track") {
      const response = await performSpotifyRequest(connection, "POST", "/me/player/previous");
      if (!response.ok) {
        return response;
      }
      return successResult(200, {
        connection_status: "connected",
        playback: { acknowledged: true },
      });
    }

    const currentPlayback = await performSpotifyRequest(connection, "GET", "/me/player");
    if (!currentPlayback.ok) {
      return currentPlayback;
    }

    const isPlaying = Boolean(currentPlayback.body?.is_playing);
    const togglePath = isPlaying ? "/me/player/pause" : "/me/player/play";
    const toggleResponse = await performSpotifyRequest(connection, "PUT", togglePath);
    if (!toggleResponse.ok) {
      return toggleResponse;
    }

    return successResult(200, {
      connection_status: "connected",
      playback: {
        is_playing: !isPlaying,
      },
    });
  }

  async function executeMockAction(projectId, request, connection) {
    const nextPlayback = {
      ...createMockPlaybackState(),
      ...connection.mock_playback,
    };

    if (request.action === "next_track") {
      nextPlayback.active_track_index += 1;
    }

    if (request.action === "previous_track") {
      nextPlayback.active_track_index = Math.max(0, nextPlayback.active_track_index - 1);
    }

    if (request.action === "play_pause") {
      nextPlayback.is_playing = !nextPlayback.is_playing;
    }

    nextPlayback.last_action = request.action;

    const updatedConnection = {
      ...connection,
      updated_at: new Date(now()).toISOString(),
      mock_playback: nextPlayback,
    };
    await writeConnection(projectId, updatedConnection);

    return successResult(200, {
      connection_status: "connected",
      playback: {
        is_playing: nextPlayback.is_playing,
        active_track_index: nextPlayback.active_track_index,
        last_action: nextPlayback.last_action,
      },
    });
  }

  async function runAction(request) {
    const actionKey = `${request.project_id}:${request.idempotency_key}`;
    const fingerprint = buildIdempotencyFingerprint(request);
    const existing = actionExecutions.get(actionKey);

    if (existing) {
      if (existing.fingerprint !== fingerprint) {
        return errorResult(
          409,
          "idempotency_conflict",
          "idempotency_key was already used for a different Spotify request",
          {
            project_id: request.project_id,
            idempotency_key: request.idempotency_key,
          }
        );
      }

      return successResult(existing.statusCode, {
        ...existing.body,
        idempotency: {
          ...existing.body.idempotency,
          replayed: true,
        },
      });
    }

    const connection = await readConnection(request.project_id);
    if (!connection) {
      return errorResult(409, "integration_not_connected", "Spotify is not connected for this project", {
        project_id: request.project_id,
      });
    }

    const connectionResponse = await refreshConnectionIfNeeded(request.project_id, connection);
    if (!connectionResponse.ok) {
      return connectionResponse;
    }

    const usableConnection = connectionResponse.body;
    const execution =
      usableConnection.mode === "mock"
        ? await executeMockAction(request.project_id, request, usableConnection)
        : await executeRealAction(request, usableConnection);

    if (!execution.ok) {
      return execution;
    }

    const body = buildActionResponse(request, usableConnection.mode, execution.body, false);
    actionExecutions.set(actionKey, {
      fingerprint,
      statusCode: 200,
      body,
    });

    return successResult(200, body);
  }

  return {
    supportedActions: SUPPORTED_ACTIONS,
    getAuthState,
    connect,
    handleCallback,
    runAction,
  };
}
