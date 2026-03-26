import { describe, expect, it } from "vitest";
import { parseProjectChannelPayload } from "./parseChannelPayload";

const graph = {
  project: {
    id: "proj_123",
    name: "Untitled Project",
    version: 1,
  },
  nodes: [],
  edges: [],
};

describe("parseProjectChannelPayload", () => {
  it("parses the documented full graph envelope", () => {
    const result = parseProjectChannelPayload("graph:updated", {
      event: "graph:updated",
      request_id: "req_1",
      project_id: "proj_123",
      payload: {
        graph,
      },
    }, "proj_fallback");

    expect(result).toEqual({
      event: "graph:updated",
      request_id: "req_1",
      project_id: "proj_123",
      payload: {
        graph,
      },
    });
  });

  it("parses error payloads carried by the channel event", () => {
    const result = parseProjectChannelPayload(
      "error",
      {
        request_id: "req_2",
        code: "cycle_detected",
        message: "Edge creation would introduce a cycle",
        details: { source_id: "node_a" },
      },
      "proj_123",
    );

    expect(result).toEqual({
      event: "error",
      request_id: "req_2",
      project_id: "proj_123",
      payload: {
        code: "cycle_detected",
        message: "Edge creation would introduce a cycle",
        details: { source_id: "node_a" },
      },
    });
  });

  it("accepts nested payload.graph messages from Phoenix channel pushes", () => {
    const result = parseProjectChannelPayload(
      "graph:init",
      {
        request_id: "req_3",
        payload: {
          graph,
        },
      },
      "proj_123",
    );

    expect(result).toEqual({
      event: "graph:init",
      request_id: "req_3",
      project_id: "proj_123",
      payload: {
        graph,
      },
    });
  });

  it("parses packet observation envelopes", () => {
    const result = parseProjectChannelPayload(
      "packet:observed",
      {
        event: "packet:observed",
        request_id: "req_4",
        project_id: "proj_123",
        payload: {
          packet: {
            packet_id: "pkt_1",
            project_id: "proj_123",
            node_id: "node_bt",
            timestamp: "2026-03-19T12:00:00.000Z",
            schema: "vector/3",
            payload: { x: 0.1, y: 0.2, z: 0.3 },
          },
          route_targets: [
            {
              node_id: "node_classifier",
              source_port: "out",
              target_port: "in",
            },
          ],
        },
      },
      "proj_123",
    );

    expect(result).toEqual({
      event: "packet:observed",
      request_id: "req_4",
      project_id: "proj_123",
      payload: {
        packet: {
          packet_id: "pkt_1",
          project_id: "proj_123",
          node_id: "node_bt",
          timestamp: "2026-03-19T12:00:00.000Z",
          schema: "vector/3",
          payload: { x: 0.1, y: 0.2, z: 0.3 },
        },
        route_targets: [
          {
            node_id: "node_classifier",
            source_port: "out",
            target_port: "in",
          },
        ],
      },
    });
  });
});
