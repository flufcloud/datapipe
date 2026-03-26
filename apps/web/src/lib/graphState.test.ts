import { describe, expect, it } from "vitest";
import {
  getRenderableGraph,
  initialGraphViewState,
  reduceGraphViewState,
  stageLocalGraphDraft,
} from "./graphState";

const baseGraph = {
  project: {
    id: "proj_123",
    name: "Untitled Project",
    version: 1,
  },
  nodes: [
    {
      id: "node_1",
      type: "Generator.ManualTest",
      category: "Generator",
      label: "Manual Input",
      position: { x: 120, y: 240 },
      configuration: {},
      ports: {
        inputs: [],
        outputs: [{ name: "out", schema: "vector/3" }],
      },
      status: "idle",
    },
  ],
  edges: [],
};

describe("graphState", () => {
  it("stores canonical graph snapshots from the orchestrator", () => {
    const next = reduceGraphViewState(initialGraphViewState, {
      event: "graph:init",
      request_id: "req_1",
      project_id: "proj_123",
      payload: { graph: baseGraph },
    });

    expect(next.canonicalGraph).toEqual(baseGraph);
    expect(next.draftGraph).toBeNull();
    expect(getRenderableGraph(next)).toEqual(baseGraph);
  });

  it("clears a local draft when the matching canonical update arrives", () => {
    const draftGraph = {
      ...baseGraph,
      nodes: [
        {
          ...baseGraph.nodes[0],
          position: { x: 180, y: 300 },
        },
      ],
    };

    const staged = stageLocalGraphDraft(initialGraphViewState, draftGraph, "req_move");
    const next = reduceGraphViewState(staged, {
      event: "graph:updated",
      request_id: "req_move",
      project_id: "proj_123",
      payload: { graph: draftGraph },
    });

    expect(next.canonicalGraph).toEqual(draftGraph);
    expect(next.draftGraph).toBeNull();
    expect(next.pendingRequestIds).toEqual([]);
  });

  it("drops a pending draft and stores the server error for rejected mutations", () => {
    const staged = stageLocalGraphDraft(initialGraphViewState, baseGraph, "req_bad");
    const next = reduceGraphViewState(staged, {
      event: "error",
      request_id: "req_bad",
      project_id: "proj_123",
      payload: {
        code: "cycle_detected",
        message: "Edge creation would introduce a cycle",
        details: {},
      },
    });

    expect(next.draftGraph).toBeNull();
    expect(next.pendingRequestIds).toEqual([]);
    expect(next.lastError).toEqual({
      code: "cycle_detected",
      message: "Edge creation would introduce a cycle",
      details: {},
    });
  });
});
