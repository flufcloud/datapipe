import type { GraphEdge, GraphNode, GraphSnapshot } from "../types/graph";

export function createNodeDraft(graph: GraphSnapshot, node: GraphNode): GraphSnapshot {
  return { ...graph, nodes: [...graph.nodes, node] };
}

export function moveNodeDraft(
  graph: GraphSnapshot,
  nodeId: string,
  position: GraphNode["position"],
): GraphSnapshot {
  return {
    ...graph,
    nodes: graph.nodes.map((node) => (node.id === nodeId ? { ...node, position } : node)),
  };
}

export function updateNodeDraft(
  graph: GraphSnapshot,
  nodeId: string,
  patch: Partial<Omit<GraphNode, "id">>,
): GraphSnapshot {
  return {
    ...graph,
    nodes: graph.nodes.map((node) => (node.id === nodeId ? { ...node, ...patch } : node)),
  };
}

export function deleteNodeDraft(graph: GraphSnapshot, nodeId: string): GraphSnapshot {
  return {
    ...graph,
    nodes: graph.nodes.filter((node) => node.id !== nodeId),
    edges: graph.edges.filter((edge) => edge.source_id !== nodeId && edge.target_id !== nodeId),
  };
}

export function createEdgeDraft(graph: GraphSnapshot, edge: GraphEdge): GraphSnapshot {
  return { ...graph, edges: [...graph.edges, edge] };
}

export function deleteEdgeDraft(graph: GraphSnapshot, edgeId: string): GraphSnapshot {
  return {
    ...graph,
    edges: graph.edges.filter((edge) => edge.id !== edgeId),
  };
}
