/** Mirrors docs/contracts/graph-schema.md (structural subset for the client). */

export type ProjectMeta = {
  id: string;
  name: string;
  version: number;
};

export type PortDef = {
  name: string;
  schema: string;
};

export type NodePorts = {
  inputs: PortDef[];
  outputs: PortDef[];
};

export type GraphNode = {
  id: string;
  type: string;
  category: string;
  label: string;
  position: { x: number; y: number };
  configuration: Record<string, unknown>;
  ports: NodePorts;
  status: string;
};

export type GraphEdge = {
  id: string;
  source_id: string;
  source_port: string;
  target_id: string;
  target_port: string;
};

export type GraphSnapshot = {
  project: ProjectMeta;
  nodes: GraphNode[];
  edges: GraphEdge[];
};

export function isGraphSnapshot(value: unknown): value is GraphSnapshot {
  if (value === null || typeof value !== "object") return false;
  const o = value as Record<string, unknown>;
  return (
    typeof o.project === "object" &&
    o.project !== null &&
    Array.isArray(o.nodes) &&
    Array.isArray(o.edges)
  );
}
