import type { PacketObservedMessage } from "../types/websocket";

export type NodePacketActivity = {
  count: number;
  lastSeenAt: string;
  lastSchema: string;
  lastPayload: Record<string, unknown>;
  routeTargets: PacketObservedMessage["payload"]["route_targets"];
  recentMagnitudes: number[];
};

export type PacketActivityState = Record<string, NodePacketActivity>;

export const initialPacketActivityState: PacketActivityState = {};

export function reducePacketActivity(
  state: PacketActivityState,
  message: PacketObservedMessage,
): PacketActivityState {
  const previous = state[message.payload.packet.node_id];
  const magnitude = vectorMagnitude(message.payload.packet.payload);
  const recentMagnitudes = magnitude === null
    ? previous?.recentMagnitudes ?? []
    : [...(previous?.recentMagnitudes ?? []), magnitude].slice(-16);

  return {
    ...state,
    [message.payload.packet.node_id]: {
      count: (previous?.count ?? 0) + 1,
      lastSeenAt: message.payload.packet.timestamp,
      lastSchema: message.payload.packet.schema,
      lastPayload: message.payload.packet.payload,
      routeTargets: message.payload.route_targets,
      recentMagnitudes,
    },
  };
}

function vectorMagnitude(payload: Record<string, unknown>) {
  const x = typeof payload.x === "number" ? payload.x : null;
  const y = typeof payload.y === "number" ? payload.y : null;
  const z = typeof payload.z === "number" ? payload.z : null;

  if (x === null || y === null || z === null) {
    return null;
  }

  return Math.sqrt(x * x + y * y + z * z);
}
