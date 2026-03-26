import type { GraphNode } from "../types/graph";

export const SPOTIFY_ACTIONS = ["next_track", "previous_track", "play_pause"] as const;

export type SpotifyAction = (typeof SPOTIFY_ACTIONS)[number];

export type SpotifyActionAttempt = {
  action: string;
  status: string;
  message: string | null;
  timestamp: string | null;
  requestId: string | null;
};

export type SpotifyConsumerState = {
  action: SpotifyAction;
  configuredAction: string;
  unsupportedAction: string | null;
  authStatus: string;
  connectionStatus: string;
  accountLabel: string | null;
  authorizationUrl: string | null;
  isConnected: boolean;
  requiresAuthorization: boolean;
  lastErrorMessage: string | null;
  history: SpotifyActionAttempt[];
  lastAttempt: SpotifyActionAttempt | null;
  nodeSummary: string;
};

const DEFAULT_ACTION: SpotifyAction = "next_track";

export function createDefaultSpotifyConfiguration(): Record<string, unknown> {
  return {
    spotify: {
      action: DEFAULT_ACTION,
    },
  };
}

export function getSpotifyConsumerState(node: GraphNode): SpotifyConsumerState {
  const spotify = asRecord(node.configuration.spotify);
  const configuredAction = firstString([spotify.action, spotify.command]) ?? DEFAULT_ACTION;
  const action = isSpotifyAction(configuredAction) ? configuredAction : DEFAULT_ACTION;
  const unsupportedAction = isSpotifyAction(configuredAction) ? null : configuredAction;
  const authStatus = getIntegrationStateLabel(
    spotify.auth_state ?? spotify.auth ?? spotify.authorization,
    "Authorized",
    "Not connected",
  );
  const connectionStatus = getIntegrationStateLabel(
    spotify.connection_state ?? spotify.connection ?? spotify.device,
    "Connected",
    "Disconnected",
  );
  const accountLabel = firstString([
    spotify.account_label,
    spotify.account_name,
    spotify.user_name,
    asRecord(spotify.auth).account_label,
    asRecord(spotify.auth).display_name,
    asRecord(asRecord(spotify.auth).connection).account
      ? firstString([
          asRecord(asRecord(asRecord(spotify.auth).connection).account).display_name,
          asRecord(asRecord(asRecord(spotify.auth).connection).account).id,
        ])
      : null,
    asRecord(spotify.auth_state).account_label,
    asRecord(spotify.auth_state).display_name,
    asRecord(spotify.connection).device_name,
    asRecord(spotify.connection_state).device_name,
  ]);
  const history = getAttemptHistory(spotify);
  const lastAttempt = history[0] ?? null;
  const authRecord = asRecord(spotify.auth);
  const authStateRecord = asRecord(spotify.auth_state);
  const authStatusRaw = firstString([authRecord.status]);
  const authorizationUrl = firstString([authRecord.authorization_url]);
  const connectionRecord = asRecord(authRecord.connection);
  const explicitConnected = firstBoolean([connectionRecord.connected, authStateRecord.connected]);
  const isConnected = explicitConnected === true || authStatusRaw === "connected";
  const requiresAuthorization = authStatusRaw === "authorization_required";
  const lastErrorMessage =
    firstString([
      asRecord(spotify.last_error).message,
      lastAttempt?.status === "error" ? lastAttempt.message : null,
    ]) ?? null;
  const nodeSummary = lastAttempt
    ? `${getSpotifyActionLabel(lastAttempt.action)} · ${humanizeToken(lastAttempt.status)}`
    : `${getSpotifyActionLabel(configuredAction)} · ${connectionStatus}`;

  return {
    action,
    configuredAction,
    unsupportedAction,
    authStatus,
    connectionStatus,
    accountLabel,
    authorizationUrl,
    isConnected,
    requiresAuthorization,
    lastErrorMessage,
    history,
    lastAttempt,
    nodeSummary,
  };
}

export function getSpotifyActionLabel(action: string) {
  switch (action) {
    case "next_track":
      return "Next Track";
    case "previous_track":
      return "Previous Track";
    case "play_pause":
      return "Play / Pause";
    default:
      return humanizeToken(action);
  }
}

function getAttemptHistory(spotify: Record<string, unknown>): SpotifyActionAttempt[] {
  const rawHistory = firstArray([
    spotify.history,
    spotify.action_history,
    spotify.recent_attempts,
    spotify.recent_actions,
    spotify.attempts,
  ]);

  return rawHistory
    .map((entry) => normalizeAttempt(entry))
    .filter((entry): entry is SpotifyActionAttempt => entry !== null)
    .slice(0, 5);
}

function normalizeAttempt(entry: unknown): SpotifyActionAttempt | null {
  if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
    return null;
  }

  const item = entry as Record<string, unknown>;
  const result = asRecord(item.result);
  const error = asRecord(item.error);
  const action = firstString([item.action, item.command]) ?? "spotify_action";
  const status =
    firstString([
      item.status,
      item.outcome,
      result.status,
      typeof item.ok === "boolean" ? (item.ok ? "succeeded" : "failed") : null,
      typeof item.success === "boolean" ? (item.success ? "succeeded" : "failed") : null,
    ]) ?? "unknown";

  return {
    action,
    status,
    message: firstString([item.message, item.error, result.message, error.message]),
    timestamp: firstString([item.timestamp, item.attempted_at, item.completed_at, item.created_at]),
    requestId: firstString([item.request_id, item.packet_id, item.idempotency_key]),
  };
}

function getIntegrationStateLabel(
  value: unknown,
  truthyLabel: string,
  falsyLabel: string,
) {
  if (typeof value === "string" && value.trim().length > 0) {
    return humanizeToken(value);
  }

  if (typeof value === "boolean") {
    return value ? truthyLabel : falsyLabel;
  }

  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    const explicit = firstString([record.status, record.state, record.label]);
    if (explicit) {
      return humanizeToken(explicit);
    }

    const truthy = firstBoolean([record.connected, record.authenticated, record.ready]);
    if (truthy !== null) {
      return truthy ? truthyLabel : falsyLabel;
    }
  }

  return "Unknown";
}

function isSpotifyAction(value: string): value is SpotifyAction {
  return SPOTIFY_ACTIONS.includes(value as SpotifyAction);
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  return {};
}

function firstString(values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.trim().length > 0) {
      return value;
    }
  }

  return null;
}

function firstBoolean(values: unknown[]): boolean | null {
  for (const value of values) {
    if (typeof value === "boolean") {
      return value;
    }
  }

  return null;
}

function firstArray(values: unknown[]): unknown[] {
  for (const value of values) {
    if (Array.isArray(value)) {
      return value;
    }
  }

  return [];
}

function humanizeToken(value: string) {
  return value
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}
