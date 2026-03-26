import { isGraphSnapshot, type GraphSnapshot } from "../types/graph";
import type { ErrorMessage, ProjectChannelPush } from "../types/websocket";

/**
 * Orchestrator may send either a full contract envelope on the channel payload
 * or a partial body with the Phoenix push `event` carrying the logical event name.
 */
export function parseProjectChannelPayload(
  channelEvent: string,
  raw: unknown,
  fallbackProjectId: string,
): ProjectChannelPush | null {
  if (raw !== null && typeof raw === "object") {
    const body = raw as Record<string, unknown>;
    const event = body.event;
    if (typeof event === "string") {
      const parsed = parseFullEnvelope(body);
      if (parsed) return parsed;
    }
  }

  if (channelEvent === "error") {
    const err = extractErrorPayload(raw);
    if (!err) return null;
    return {
      event: "error",
      request_id: extractRequestId(raw),
      project_id: extractProjectId(raw) ?? fallbackProjectId,
      payload: err,
    };
  }

  const graph = extractGraphSnapshot(channelEvent, raw);
  if (!graph) return null;

  const base = {
    request_id: extractRequestId(raw),
    project_id: extractProjectId(raw) ?? fallbackProjectId,
    payload: { graph },
  };

  if (channelEvent === "graph:init") {
    return { event: "graph:init", ...base };
  }
  if (channelEvent === "graph:updated") {
    return { event: "graph:updated", ...base };
  }

  return null;
}

function parseFullEnvelope(body: Record<string, unknown>): ProjectChannelPush | null {
  const event = body.event;
  const request_id = body.request_id;
  const project_id = body.project_id;
  const payload = body.payload;

  if (
    typeof event !== "string" ||
    typeof request_id !== "string" ||
    typeof project_id !== "string" ||
    payload === null ||
    typeof payload !== "object"
  ) {
    return null;
  }

  if (event === "error") {
    const p = payload as Record<string, unknown>;
    const code = p.code;
    const message = p.message;
    const details = p.details;
    if (typeof code !== "string" || typeof message !== "string") return null;
    return {
      event: "error",
      request_id,
      project_id,
      payload: {
        code,
        message,
        details:
          details !== null && typeof details === "object" && !Array.isArray(details)
            ? (details as Record<string, unknown>)
            : {},
      },
    };
  }

  if (event === "packet:observed") {
    const p = payload as Record<string, unknown>;
    const packet = p.packet;
    const routeTargets = p.route_targets;

    if (!isPacket(packet) || !isRouteTargets(routeTargets)) {
      return null;
    }

    return {
      event: "packet:observed",
      request_id,
      project_id,
      payload: {
        packet,
        route_targets: routeTargets,
      },
    };
  }

  if (event === "graph:updated" || event === "graph:init") {
    const p = payload as Record<string, unknown>;
    const graph = p.graph;
    if (!isGraphSnapshot(graph)) return null;
    return {
      event,
      request_id,
      project_id,
      payload: { graph },
    };
  }

  return null;
}

function isPacket(value: unknown): value is {
  packet_id: string;
  project_id: string;
  node_id: string;
  timestamp: string;
  schema: string;
  payload: Record<string, unknown>;
} {
  if (value === null || typeof value !== "object") {
    return false;
  }

  const packet = value as Record<string, unknown>;

  return (
    typeof packet.packet_id === "string" &&
    typeof packet.project_id === "string" &&
    typeof packet.node_id === "string" &&
    typeof packet.timestamp === "string" &&
    typeof packet.schema === "string" &&
    packet.payload !== null &&
    typeof packet.payload === "object" &&
    !Array.isArray(packet.payload)
  );
}

function isRouteTargets(value: unknown): value is Array<{
  node_id: string;
  source_port: string;
  target_port: string;
}> {
  return (
    Array.isArray(value) &&
    value.every(
      (item) =>
        item !== null &&
        typeof item === "object" &&
        typeof (item as { node_id?: unknown }).node_id === "string" &&
        typeof (item as { source_port?: unknown }).source_port === "string" &&
        typeof (item as { target_port?: unknown }).target_port === "string",
    )
  );
}

function extractGraphSnapshot(channelEvent: string, raw: unknown): GraphSnapshot | null {
  if (channelEvent !== "graph:updated" && channelEvent !== "graph:init") {
    return null;
  }
  if (raw === null || typeof raw !== "object") return null;
  const body = raw as Record<string, unknown>;
  if (isGraphSnapshot(body.graph)) return body.graph;
  if (
    body.payload !== null &&
    typeof body.payload === "object" &&
    isGraphSnapshot((body.payload as Record<string, unknown>).graph)
  ) {
    return (body.payload as { graph: GraphSnapshot }).graph;
  }
  if (isGraphSnapshot(body)) return body as GraphSnapshot;
  return null;
}

function extractErrorPayload(raw: unknown): ErrorMessage["payload"] | null {
  if (raw === null || typeof raw !== "object") return null;
  const body = raw as Record<string, unknown>;
  const nested =
    body.payload !== null && typeof body.payload === "object"
      ? (body.payload as Record<string, unknown>)
      : body;
  const code = nested.code;
  const message = nested.message;
  const details = nested.details;
  if (typeof code !== "string" || typeof message !== "string") return null;
  return {
    code,
    message,
    details:
      details !== null && typeof details === "object" && !Array.isArray(details)
        ? (details as Record<string, unknown>)
        : {},
  };
}

function extractRequestId(raw: unknown): string {
  if (
    raw !== null &&
    typeof raw === "object" &&
    typeof (raw as { request_id?: unknown }).request_id === "string"
  ) {
    return (raw as { request_id: string }).request_id;
  }
  return "server_push";
}

function extractProjectId(raw: unknown): string | undefined {
  if (
    raw !== null &&
    typeof raw === "object" &&
    typeof (raw as { project_id?: unknown }).project_id === "string"
  ) {
    return (raw as { project_id: string }).project_id;
  }
  return undefined;
}
