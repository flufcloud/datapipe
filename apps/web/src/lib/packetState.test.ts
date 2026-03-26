import { describe, expect, it } from "vitest";
import { initialPacketActivityState, reducePacketActivity } from "./packetState";

describe("reducePacketActivity", () => {
  it("tracks the latest packet per node", () => {
    const next = reducePacketActivity(initialPacketActivityState, {
      event: "packet:observed",
      request_id: "req_packet",
      project_id: "proj_demo",
      payload: {
        packet: {
          packet_id: "pkt_1",
          project_id: "proj_demo",
          node_id: "node_bt",
          timestamp: "2026-03-19T12:00:00.000Z",
          schema: "vector/3",
          payload: { x: 0.1, y: 0.2, z: 0.3 },
        },
        route_targets: [{ node_id: "node_classifier", source_port: "out", target_port: "in" }],
      },
    });

    expect(next.node_bt.count).toBe(1);
    expect(next.node_bt.lastSchema).toBe("vector/3");
    expect(next.node_bt.routeTargets).toHaveLength(1);
    expect(next.node_bt.recentMagnitudes).toHaveLength(1);
  });
});
