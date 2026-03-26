import type { GraphSnapshot } from "./graph";

/** Base fields shared by docs/contracts/websocket-events.md envelopes. */
export type WsEnvelopeBase = {
  request_id: string;
  project_id: string;
};

export type Packet = {
  packet_id: string;
  project_id: string;
  node_id: string;
  timestamp: string;
  schema: string;
  payload: Record<string, unknown>;
};

export type PacketRouteTarget = {
  node_id: string;
  source_port: string;
  target_port: string;
};

export type GraphEventPayload = {
  graph: GraphSnapshot;
};

export type ErrorEventPayload = {
  code: string;
  message: string;
  details: Record<string, unknown>;
};

export type PacketObservedPayload = {
  packet: Packet;
  route_targets: PacketRouteTarget[];
};

export type GraphUpdatedMessage = WsEnvelopeBase & {
  event: "graph:updated";
  payload: GraphEventPayload;
};

export type GraphInitMessage = WsEnvelopeBase & {
  event: "graph:init";
  payload: GraphEventPayload;
};

export type ErrorMessage = WsEnvelopeBase & {
  event: "error";
  payload: ErrorEventPayload;
};

export type PacketObservedMessage = WsEnvelopeBase & {
  event: "packet:observed";
  payload: PacketObservedPayload;
};

export type ProjectChannelPush =
  | GraphUpdatedMessage
  | GraphInitMessage
  | PacketObservedMessage
  | ErrorMessage;

export const PROJECT_CLIENT_EVENTS = [
  "graph:init",
  "node:create",
  "node:update",
  "node:update_position",
  "node:delete",
  "edge:create",
  "edge:delete",
  "packet:ingest",
  "classifier:record_start",
  "classifier:record_stop",
  "classifier:train",
  "classifier:inference_start",
  "classifier:inference_stop",
  "consumer:spotify_connect",
  "consumer:spotify_auth_state",
] as const;

export type ProjectClientEvent = (typeof PROJECT_CLIENT_EVENTS)[number];

export function isErrorMessage(m: ProjectChannelPush): m is ErrorMessage {
  return m.event === "error";
}

export function isGraphSyncMessage(
  m: ProjectChannelPush,
): m is GraphUpdatedMessage | GraphInitMessage {
  return m.event === "graph:updated" || m.event === "graph:init";
}

export function isPacketObservedMessage(m: ProjectChannelPush): m is PacketObservedMessage {
  return m.event === "packet:observed";
}
