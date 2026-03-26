import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import type { GraphNode, GraphSnapshot } from "../types/graph";

const NODE_W = 160;
const NODE_H = 82;
const VIEWBOX_W = 1200;
const VIEWBOX_H = 720;

type GraphCanvasProps = {
  graph: GraphSnapshot | null;
  selectedNodeId: string | null;
  onSelectNode: (nodeId: string | null) => void;
  onNodePositionCommit: (nodeId: string, position: GraphNode["position"]) => void;
  getNodeStatusText?: (node: GraphNode) => string | null;
};

type Point = { x: number; y: number };

export function GraphCanvas(props: GraphCanvasProps) {
  const { graph, selectedNodeId, onSelectNode, onNodePositionCommit, getNodeStatusText } = props;
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState<Point>({ x: 0, y: 0 });
  const [dragging, setDragging] = useState<{ nodeId: string; offset: Point } | null>(null);
  const [panning, setPanning] = useState<{ start: Point; pan: Point } | null>(null);
  const [localPositions, setLocalPositions] = useState<Record<string, Point>>({});

  useEffect(() => {
    setLocalPositions({});
  }, [graph]);

  const nodePositions = useMemo(() => {
    const positions = new Map<string, Point>();

    for (const node of graph?.nodes ?? []) {
      positions.set(node.id, localPositions[node.id] ?? node.position);
    }

    return positions;
  }, [graph, localPositions]);

  if (!graph) {
    return (
      <div className="graph-canvas graph-canvas--empty">
        <p>No graph snapshot yet. Waiting for the orchestrator…</p>
      </div>
    );
  }

  const { nodes, edges } = graph;

  function clientToBasePoint(clientX: number, clientY: number): Point | null {
    const svg = svgRef.current;

    if (!svg) {
      return null;
    }

    const rect = svg.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) {
      return null;
    }

    return {
      x: ((clientX - rect.left) / rect.width) * VIEWBOX_W,
      y: ((clientY - rect.top) / rect.height) * VIEWBOX_H,
    };
  }

  function clientToGraphPoint(clientX: number, clientY: number): Point | null {
    const base = clientToBasePoint(clientX, clientY);

    if (!base) {
      return null;
    }

    return {
      x: Math.round((base.x - pan.x) / zoom),
      y: Math.round((base.y - pan.y) / zoom),
    };
  }

  function handleCanvasPointerDown(event: ReactPointerEvent<SVGRectElement>) {
    onSelectNode(null);

    const start = clientToBasePoint(event.clientX, event.clientY);
    if (!start) {
      return;
    }

    setPanning({ start, pan });
  }

  function handleNodePointerDown(
    event: ReactPointerEvent<SVGGElement>,
    node: GraphNode,
    position: Point,
  ) {
    event.stopPropagation();
    onSelectNode(node.id);

    const pointer = clientToGraphPoint(event.clientX, event.clientY);
    if (!pointer) {
      return;
    }

    setDragging({
      nodeId: node.id,
      offset: {
        x: pointer.x - position.x,
        y: pointer.y - position.y,
      },
    });
  }

  function handlePointerMove(event: ReactPointerEvent<SVGSVGElement>) {
    if (dragging) {
      const pointer = clientToGraphPoint(event.clientX, event.clientY);
      if (!pointer) {
        return;
      }

      setLocalPositions((prev) => ({
        ...prev,
        [dragging.nodeId]: {
          x: Math.max(0, pointer.x - dragging.offset.x),
          y: Math.max(0, pointer.y - dragging.offset.y),
        },
      }));

      return;
    }

    if (panning) {
      const current = clientToBasePoint(event.clientX, event.clientY);
      if (!current) {
        return;
      }

      setPan({
        x: panning.pan.x + (current.x - panning.start.x),
        y: panning.pan.y + (current.y - panning.start.y),
      });
    }
  }

  function commitDrag() {
    if (!dragging) {
      setPanning(null);
      return;
    }

    const position = localPositions[dragging.nodeId];
    if (position) {
      onNodePositionCommit(dragging.nodeId, position);
    }

    setDragging(null);
    setPanning(null);
  }

  function resetViewport() {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }

  return (
    <div className="graph-canvas">
      <div className="graph-canvas__toolbar">
        <div className="graph-canvas__controls">
          <button className="button button--ghost" type="button" onClick={() => setZoom((z) => Math.max(0.6, z - 0.1))}>
            Zoom -
          </button>
          <button className="button button--ghost" type="button" onClick={() => setZoom((z) => Math.min(2.2, z + 0.1))}>
            Zoom +
          </button>
          <button className="button button--ghost" type="button" onClick={resetViewport}>
            Reset View
          </button>
        </div>
        <span className="pill">Zoom {Math.round(zoom * 100)}%</span>
      </div>

      <svg
        ref={svgRef}
        className="graph-canvas__svg"
        viewBox={`0 0 ${VIEWBOX_W} ${VIEWBOX_H}`}
        role="img"
        aria-label="Graph"
        onPointerMove={handlePointerMove}
        onPointerUp={commitDrag}
        onPointerLeave={commitDrag}
      >
        <defs>
          <marker
            id="arrow"
            viewBox="0 0 10 10"
            refX="8"
            refY="5"
            markerWidth="6"
            markerHeight="6"
            orient="auto-start-reverse"
          >
            <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--edge)" />
          </marker>
        </defs>

        <rect
          width="100%"
          height="100%"
          rx="8"
          fill="transparent"
          data-canvas-bg
          onPointerDown={handleCanvasPointerDown}
        />

        <g transform={`translate(${pan.x} ${pan.y}) scale(${zoom})`}>
          {edges.map((edge) => {
            const from = nodes.find((node) => node.id === edge.source_id);
            const to = nodes.find((node) => node.id === edge.target_id);

            if (!from || !to) {
              return null;
            }

            const fromPosition = nodePositions.get(from.id) ?? from.position;
            const toPosition = nodePositions.get(to.id) ?? to.position;
            const x1 = fromPosition.x + NODE_W;
            const y1 = fromPosition.y + NODE_H / 2;
            const x2 = toPosition.x;
            const y2 = toPosition.y + NODE_H / 2;
            const mid = (x1 + x2) / 2;

            return (
              <path
                key={edge.id}
                d={`M ${x1} ${y1} C ${mid} ${y1}, ${mid} ${y2}, ${x2} ${y2}`}
                fill="none"
                stroke="var(--edge)"
                strokeWidth="2"
                markerEnd="url(#arrow)"
              />
            );
          })}

          {nodes.map((node) => {
            const position = nodePositions.get(node.id) ?? node.position;
            const isSelected = node.id === selectedNodeId;
            const statusText = getNodeStatusText?.(node) ?? null;

            return (
              <g
                key={node.id}
                transform={`translate(${position.x}, ${position.y})`}
                onPointerDown={(event) => handleNodePointerDown(event, node, position)}
              >
                <rect
                  width={NODE_W}
                  height={NODE_H}
                  rx="10"
                  fill="var(--node-fill)"
                  stroke={isSelected ? "var(--accent)" : "var(--node-stroke)"}
                  strokeWidth={isSelected ? "2.5" : "1.5"}
                />
                <circle cx={10} cy={NODE_H / 2} r="5" fill="var(--edge)" />
                <circle cx={NODE_W - 10} cy={NODE_H / 2} r="5" fill="var(--edge)" />
                <text
                  x={NODE_W / 2}
                  y={NODE_H / 2 - 16}
                  textAnchor="middle"
                  fill="var(--text)"
                  fontSize="12"
                  fontWeight="600"
                >
                  {truncate(node.label, 20)}
                </text>
                <text
                  x={NODE_W / 2}
                  y={NODE_H / 2 + 2}
                  textAnchor="middle"
                  fill="var(--muted)"
                  fontSize="10"
                >
                  {truncate(node.type, 24)}
                </text>
                {statusText ? (
                  <text
                    x={NODE_W / 2}
                    y={NODE_H / 2 + 20}
                    textAnchor="middle"
                    fill="var(--accent)"
                    fontSize="9"
                  >
                    {truncate(statusText, 24)}
                  </text>
                ) : null}
              </g>
            );
          })}
        </g>
      </svg>

      <footer className="graph-canvas__meta">
        <span>
          Project <code>{graph.project.name}</code> · v{graph.project.version}
        </span>
        <span>
          {nodes.length} nodes · {edges.length} edges
        </span>
      </footer>
    </div>
  );
}

function truncate(value: string, max: number) {
  if (value.length <= max) {
    return value;
  }

  return `${value.slice(0, max - 1)}…`;
}
