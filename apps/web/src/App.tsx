import { useEffect, useMemo, useRef, useState } from "react";
import { ConnectionStatus } from "./components/ConnectionStatus";
import { GraphCanvas } from "./components/GraphCanvas";
import {
  browserBluetoothSupported,
  startDemoVectorStream,
  startMicrobitStream,
  type BluetoothStreamHandle,
} from "./lib/bluetoothGenerator";
import {
  createEdgeDraft,
  createNodeDraft,
  deleteEdgeDraft,
  deleteNodeDraft,
  moveNodeDraft,
  updateNodeDraft,
} from "./lib/graphDraft";
import {
  getRenderableGraph,
  initialGraphViewState,
  stageLocalGraphDraft,
  reduceGraphViewState,
} from "./lib/graphState";
import { createNodeFromTemplate, NODE_TEMPLATES } from "./lib/nodeCatalog";
import { initialPacketActivityState, reducePacketActivity } from "./lib/packetState";
import {
  connectProjectChannel,
  parseProjectChannelPayload,
  pushMutation,
  requestInitialGraph,
  type ProjectChannelConnection,
} from "./lib/projectChannel";
import { createRequestId } from "./lib/requestId";
import {
  getSpotifyActionLabel,
  getSpotifyConsumerState,
  SPOTIFY_ACTIONS,
  type SpotifyAction,
} from "./lib/spotifyConsumer";
import type { SocketConnectionStatus } from "./lib/projectChannel";
import type { GraphEdge, GraphNode, GraphSnapshot } from "./types/graph";
import { isPacketObservedMessage, type Packet, type ProjectClientEvent } from "./types/websocket";

const DEFAULT_PROJECT_ID = "proj_demo";

export function App() {
  const projectId = import.meta.env.VITE_DATAPIPE_PROJECT_ID ?? DEFAULT_PROJECT_ID;
  const socketPath = import.meta.env.VITE_DATAPIPE_SOCKET_PATH ?? defaultSocketPath();
  const connectionRef = useRef<ProjectChannelConnection | null>(null);
  const bluetoothStreamRef = useRef<{ nodeId: string; handle: BluetoothStreamHandle } | null>(null);
  const [connectionEpoch, setConnectionEpoch] = useState(0);
  const [status, setStatus] = useState<SocketConnectionStatus>("connecting");
  const [statusDetail, setStatusDetail] = useState<string>();
  const [viewState, setViewState] = useState(initialGraphViewState);
  const [packetActivity, setPacketActivity] = useState(initialPacketActivityState);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [sourceNodeId, setSourceNodeId] = useState("");
  const [sourcePort, setSourcePort] = useState("");
  const [targetNodeId, setTargetNodeId] = useState("");
  const [targetPort, setTargetPort] = useState("");
  const [bluetoothStatus, setBluetoothStatus] = useState<string>("Idle");
  const [recordingLabel, setRecordingLabel] = useState("clockwise");

  useEffect(() => {
    let active = true;

    const connection = connectProjectChannel({
      projectId,
      socketPath,
      handlers: {
        onStatus: (nextStatus, detail) => {
          if (!active) return;

          setStatus(nextStatus);
          setStatusDetail(detail);

          if (nextStatus === "ready") {
            requestInitialGraph(connection.channel, projectId, createRequestId("graph_init"))
              .receive("error", (resp: unknown) => {
                if (!active) return;
                setStatus("error");
                setStatusDetail(formatPushError(resp, "graph:init request failed"));
              })
              .receive("timeout", () => {
                if (!active) return;
                setStatus("error");
                setStatusDetail("graph:init request timed out");
              });
          }
        },
        onMessage: (channelEvent, rawPayload) => {
          if (!active) return;

          const parsed = parseProjectChannelPayload(channelEvent, rawPayload, projectId);

          if (!parsed) {
            setStatusDetail(`Ignored unexpected payload for ${channelEvent}`);
            return;
          }

          if (isPacketObservedMessage(parsed)) {
            setPacketActivity((prev) => reducePacketActivity(prev, parsed));
            return;
          }

          setViewState((prev) => reduceGraphViewState(prev, parsed));
        },
      },
    });
    connectionRef.current = connection;

    return () => {
      active = false;
      if (connectionRef.current === connection) {
        connectionRef.current = null;
      }
      void stopBluetoothStream(false);
      connection.disconnect();
    };
  }, [connectionEpoch, projectId, socketPath]);

  const graph = useMemo(() => getRenderableGraph(viewState), [viewState]);
  const selectedNode = graph?.nodes.find((node) => node.id === selectedNodeId) ?? null;
  const selectedNodePacketActivity = selectedNode ? packetActivity[selectedNode.id] : undefined;
  const classifierConfig = selectedNode ? getClassifierConfig(selectedNode) : null;
  const fusionConfig = selectedNode ? getFusionConfig(selectedNode) : null;
  const spotifyState = selectedNode?.type === "Consumer.Spotify" ? getSpotifyConsumerState(selectedNode) : null;
  const hasPendingDraft = viewState.pendingRequestIds.length > 0;
  const sourceNode = graph?.nodes.find((node) => node.id === sourceNodeId) ?? null;
  const targetNode = graph?.nodes.find((node) => node.id === targetNodeId) ?? null;
  const sourcePorts = sourceNode?.ports.outputs ?? [];
  const targetPorts = targetNode?.ports.inputs ?? [];
  const selectedNodeUpstreamDependencies =
    selectedNode && graph ? getUpstreamDependencies(graph, selectedNode.id) : [];

  useEffect(() => {
    if (!graph) {
      setSelectedNodeId(null);
      return;
    }

    if (selectedNodeId && graph.nodes.some((node) => node.id === selectedNodeId)) {
      return;
    }

    setSelectedNodeId(graph.nodes[0]?.id ?? null);
  }, [graph, selectedNodeId]);

  useEffect(() => {
    if (!graph) {
      setSourceNodeId("");
      setSourcePort("");
      setTargetNodeId("");
      setTargetPort("");
      return;
    }

    const nextSourceNode = graph.nodes.find((node) => node.id === sourceNodeId && node.ports.outputs.length > 0)
      ?? graph.nodes.find((node) => node.ports.outputs.length > 0)
      ?? null;
    const nextTargetNode = graph.nodes.find((node) => node.id === targetNodeId && node.ports.inputs.length > 0)
      ?? graph.nodes.find((node) => node.ports.inputs.length > 0)
      ?? null;

    const nextSourcePort = nextSourceNode?.ports.outputs.find((portDef) => portDef.name === sourcePort)?.name
      ?? nextSourceNode?.ports.outputs[0]?.name
      ?? "";
    const nextTargetPort = nextTargetNode?.ports.inputs.find((portDef) => portDef.name === targetPort)?.name
      ?? nextTargetNode?.ports.inputs[0]?.name
      ?? "";

    setSourceNodeId(nextSourceNode?.id ?? "");
    setSourcePort(nextSourcePort);
    setTargetNodeId(nextTargetNode?.id ?? "");
    setTargetPort(nextTargetPort);
  }, [graph, sourceNodeId, sourcePort, targetNodeId, targetPort]);

  function submitMutation(
    event: ProjectClientEvent,
    payload: Record<string, unknown>,
    optimisticGraph: ((graph: GraphSnapshot) => GraphSnapshot) | null = null,
  ) {
    const connection = connectionRef.current;
    if (!connection) {
      setStatus("error");
      setStatusDetail("Not connected to project channel");
      return;
    }

    const requestId = createRequestId(event.replace(":", "_"));

    if (optimisticGraph) {
      setViewState((prev) => {
        const baseGraph = getRenderableGraph(prev);
        if (!baseGraph) {
          return prev;
        }

        return stageLocalGraphDraft(prev, optimisticGraph(baseGraph), requestId);
      });
    }

    pushMutation(connection.channel, event, projectId, requestId, payload)
      .receive("error", (resp: unknown) => {
        setStatus("error");
        setStatusDetail(formatPushError(resp, `${event} request failed`));
        setViewState((prev) => failPendingRequest(prev, requestId, `${event} request failed`));
      })
      .receive("timeout", () => {
        setStatus("error");
        setStatusDetail(`${event} request timed out`);
        setViewState((prev) => failPendingRequest(prev, requestId, `${event} request timed out`));
      });
  }

  function submitPacket(packet: Packet) {
    const connection = connectionRef.current;
    if (!connection) {
      setStatus("error");
      setStatusDetail("Not connected to project channel");
      return;
    }

    const requestId = createRequestId("packet");

    pushMutation(connection.channel, "packet:ingest", projectId, requestId, packet)
      .receive("error", (resp: unknown) => {
        setStatus("error");
        setStatusDetail(formatPushError(resp, "packet:ingest failed"));
      })
      .receive("timeout", () => {
        setStatus("error");
        setStatusDetail("packet:ingest timed out");
      });
  }

  function handleAddNode(templateType: string) {
    const template = NODE_TEMPLATES.find((entry) => entry.type === templateType);
    if (!template || !graph) {
      return;
    }

    const node = createNodeFromTemplate(template, createRequestId("node"), nextNodePosition(graph));
    setSelectedNodeId(node.id);

    submitMutation("node:create", node, (current) => createNodeDraft(current, node));
  }

  function handleDeleteSelectedNode() {
    if (!graph || !selectedNode) {
      return;
    }

    if (bluetoothStreamRef.current?.nodeId === selectedNode.id) {
      void stopBluetoothStream();
    }

    const nodeId = selectedNode.id;
    setSelectedNodeId(null);
    submitMutation("node:delete", { id: nodeId }, (current) => deleteNodeDraft(current, nodeId));
  }

  function handleNodePositionCommit(nodeId: string, position: GraphNode["position"]) {
    if (!graph) {
      return;
    }

    submitMutation(
      "node:update_position",
      { id: nodeId, position },
      (current) => moveNodeDraft(current, nodeId, position),
    );
  }

  function handleConnectNodes() {
    if (!graph || !sourceNodeId || !sourcePort || !targetNodeId || !targetPort) {
      return;
    }

    const edge: GraphEdge = {
      id: createRequestId("edge"),
      source_id: sourceNodeId,
      source_port: sourcePort,
      target_id: targetNodeId,
      target_port: targetPort,
    };

    submitMutation("edge:create", edge, (current) => createEdgeDraft(current, edge));
  }

  function handleDeleteEdge(edgeId: string) {
    if (!graph) {
      return;
    }

    submitMutation("edge:delete", { id: edgeId }, (current) => deleteEdgeDraft(current, edgeId));
  }

  async function startBluetoothStream(mode: "device" | "demo") {
    if (!selectedNode || selectedNode.type !== "Generator.Bluetooth") {
      return;
    }

    await stopBluetoothStream();

    setBluetoothStatus(mode === "device" ? "Connecting to Bluetooth device" : "Starting demo stream");
    submitMutation("node:update", { id: selectedNode.id, status: "active" });

    try {
      const handle =
        mode === "device"
          ? await startMicrobitStream({
              projectId,
              nodeId: selectedNode.id,
              onPacket: submitPacket,
              onStatus: setBluetoothStatus,
            })
          : startDemoVectorStream({
              projectId,
              nodeId: selectedNode.id,
              onPacket: submitPacket,
              onStatus: setBluetoothStatus,
            });

      bluetoothStreamRef.current = { nodeId: selectedNode.id, handle };
      setBluetoothStatus(mode === "device" ? "Streaming from Bluetooth device" : "Streaming demo sensor data");
    } catch (error) {
      submitMutation("node:update", { id: selectedNode.id, status: "error" });
      setBluetoothStatus(error instanceof Error ? error.message : "Failed to start Bluetooth stream");
    }
  }

  async function stopBluetoothStream(syncNodeStatus = true) {
    const active = bluetoothStreamRef.current;
    if (!active) {
      return;
    }

    bluetoothStreamRef.current = null;
    await active.handle.stop();
    if (syncNodeStatus && connectionRef.current) {
      submitMutation("node:update", { id: active.nodeId, status: "idle" });
    }
    setBluetoothStatus("Idle");
  }

  function handleClassifierRecordStart() {
    if (!selectedNode || selectedNode.type !== "Modifier.Classifier") {
      return;
    }

    submitMutation("classifier:record_start", {
      id: selectedNode.id,
      label: recordingLabel,
    });
  }

  function handleClassifierRecordStop() {
    if (!selectedNode || selectedNode.type !== "Modifier.Classifier") {
      return;
    }

    submitMutation("classifier:record_stop", { id: selectedNode.id });
  }

  function handleClassifierTrain() {
    if (!selectedNode || selectedNode.type !== "Modifier.Classifier") {
      return;
    }

    submitMutation("classifier:train", {
      id: selectedNode.id,
      window_size: classifierConfig?.window_size ?? 8,
      epochs: classifierConfig?.epochs ?? 20,
    });
  }

  function handleInferenceStart() {
    if (!selectedNode || selectedNode.type !== "Modifier.Classifier") {
      return;
    }

    submitMutation("classifier:inference_start", { id: selectedNode.id });
  }

  function handleInferenceStop() {
    if (!selectedNode || selectedNode.type !== "Modifier.Classifier") {
      return;
    }

    submitMutation("classifier:inference_stop", { id: selectedNode.id });
  }

  function handleSpotifyActionChange(action: SpotifyAction) {
    if (!selectedNode || selectedNode.type !== "Consumer.Spotify") {
      return;
    }

    const nextConfiguration = {
      ...selectedNode.configuration,
      spotify: {
        ...getRecord(selectedNode.configuration.spotify),
        action,
      },
    };

    submitMutation(
      "node:update",
      {
        id: selectedNode.id,
        configuration: nextConfiguration,
      },
      (current) =>
        updateNodeDraft(current, selectedNode.id, {
          configuration: nextConfiguration,
        }),
    );
  }

  function handleSpotifyConnect() {
    if (!selectedNode || selectedNode.type !== "Consumer.Spotify") {
      return;
    }

    submitMutation("consumer:spotify_connect", { id: selectedNode.id });
  }

  function handleSpotifyAuthStateRefresh() {
    if (!selectedNode || selectedNode.type !== "Consumer.Spotify") {
      return;
    }

    submitMutation("consumer:spotify_auth_state", { id: selectedNode.id });
  }

  function handleFusionRuleChange(
    field: "left_label" | "right_label" | "output_label" | "confidence",
    value: string,
  ) {
    if (!selectedNode || selectedNode.type !== "Modifier.Fusion") {
      return;
    }

    const existingFusion = getRecord(selectedNode.configuration.fusion);
    const existingRules = Array.isArray(existingFusion.rules)
      ? existingFusion.rules.map((rule) => getRecord(rule))
      : [];
    const currentRule = existingRules[0] ?? {};
    const nextRule = {
      ...currentRule,
      [field]: field === "confidence" ? Number(value) || 0 : value,
    };

    const nextConfiguration = {
      ...selectedNode.configuration,
      fusion: {
        ...existingFusion,
        rules: [nextRule],
      },
    };

    submitMutation(
      "node:update",
      {
        id: selectedNode.id,
        configuration: nextConfiguration,
      },
      (current) =>
        updateNodeDraft(current, selectedNode.id, {
          configuration: nextConfiguration,
        }),
    );
  }

  function handleFusionWindowChange(value: string) {
    if (!selectedNode || selectedNode.type !== "Modifier.Fusion") {
      return;
    }

    const nextConfiguration = {
      ...selectedNode.configuration,
      fusion: {
        ...getRecord(selectedNode.configuration.fusion),
        window_ms: Math.max(250, Number(value) || 5000),
      },
    };

    submitMutation(
      "node:update",
      {
        id: selectedNode.id,
        configuration: nextConfiguration,
      },
      (current) =>
        updateNodeDraft(current, selectedNode.id, {
          configuration: nextConfiguration,
        }),
    );
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">DataPipe</p>
          <h1>Realtime Graph Canvas</h1>
          <p className="subtitle">
            Connected to <code>project:{projectId}</code> and ready to reconcile local UI
            state with canonical orchestrator snapshots.
          </p>
        </div>

        <div className="topbar__actions">
          <ConnectionStatus status={status} detail={statusDetail} />
          <button className="button" type="button" onClick={() => setConnectionEpoch((v) => v + 1)}>
            Reconnect
          </button>
        </div>
      </header>

      <main className="layout">
        <section className="panel panel--canvas">
          <div className="panel__header">
            <div>
              <h2>Graph View</h2>
              <p className="panel__subtext">
                Drag nodes to move them, drag the background to pan, and use the toolbar to zoom.
              </p>
            </div>
            <span className="pill">{graph ? "Snapshot loaded" : "Waiting for graph"}</span>
          </div>

          <GraphCanvas
            graph={graph}
            selectedNodeId={selectedNodeId}
            onSelectNode={setSelectedNodeId}
            onNodePositionCommit={handleNodePositionCommit}
            getNodeStatusText={getNodeCanvasStatusText}
          />
        </section>

        <aside className="sidebar">
          <section className="panel">
            <div className="panel__header">
              <div>
                <h2>Session</h2>
                <p className="panel__subtext">Frontend-only connection metadata.</p>
              </div>
            </div>

            <dl className="meta-list">
              <div>
                <dt>Socket</dt>
                <dd>
                  <code>{socketPath}</code>
                </dd>
              </div>
              <div>
                <dt>Topic</dt>
                <dd>
                  <code>project:{projectId}</code>
                </dd>
              </div>
              <div>
                <dt>Source of truth</dt>
                <dd>Orchestrator canonical graph</dd>
              </div>
              <div>
                <dt>Render source</dt>
                <dd>{hasPendingDraft ? "Local draft pending reconciliation" : "Canonical snapshot"}</dd>
              </div>
              <div>
                <dt>Pending request ids</dt>
                <dd>{viewState.pendingRequestIds.length}</dd>
              </div>
            </dl>
          </section>

          <section className="panel">
            <div className="panel__header">
              <div>
                <h2>Node Palette</h2>
                <p className="panel__subtext">Add generator, modifier, and consumer nodes to the graph.</p>
              </div>
            </div>
            <div className="action-grid">
              {NODE_TEMPLATES.map((template) => (
                <button
                  key={template.type}
                  className="button"
                  type="button"
                  disabled={!graph}
                  onClick={() => handleAddNode(template.type)}
                >
                  Add {template.label}
                </button>
              ))}
            </div>
          </section>

          <section className="panel">
            <div className="panel__header">
              <div>
                <h2>Edge Builder</h2>
                <p className="panel__subtext">Create compatible graph connections.</p>
              </div>
            </div>
            <div className="form-grid">
              <label>
                <span>Source node</span>
                <select value={sourceNodeId} onChange={(event) => setSourceNodeId(event.target.value)}>
                  <option value="">Select source</option>
                  {graph?.nodes
                    .filter((node) => node.ports.outputs.length > 0)
                    .map((node) => (
                      <option key={node.id} value={node.id}>
                        {node.label}
                      </option>
                    ))}
                </select>
              </label>

              <label>
                <span>Source port</span>
                <select value={sourcePort} onChange={(event) => setSourcePort(event.target.value)}>
                  <option value="">Select output</option>
                  {sourcePorts.map((portDef) => (
                    <option key={portDef.name} value={portDef.name}>
                      {portDef.name} · {portDef.schema}
                    </option>
                  ))}
                </select>
              </label>

              <label>
                <span>Target node</span>
                <select value={targetNodeId} onChange={(event) => setTargetNodeId(event.target.value)}>
                  <option value="">Select target</option>
                  {graph?.nodes
                    .filter((node) => node.ports.inputs.length > 0)
                    .map((node) => (
                      <option key={node.id} value={node.id}>
                        {node.label}
                      </option>
                    ))}
                </select>
              </label>

              <label>
                <span>Target port</span>
                <select value={targetPort} onChange={(event) => setTargetPort(event.target.value)}>
                  <option value="">Select input</option>
                  {targetPorts.map((portDef) => (
                    <option key={portDef.name} value={portDef.name}>
                      {portDef.name} · {portDef.schema}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <button
              className="button"
              type="button"
              disabled={!graph || !sourceNodeId || !targetNodeId || !sourcePort || !targetPort}
              onClick={handleConnectNodes}
            >
              Connect Nodes
            </button>
          </section>

          <section className="panel">
            <div className="panel__header">
              <div>
                <h2>Selected Node</h2>
                <p className="panel__subtext">Inspect or remove the current node.</p>
              </div>
            </div>

            {selectedNode ? (
              <>
                <dl className="meta-list">
                  <div>
                    <dt>Label</dt>
                    <dd>{selectedNode.label}</dd>
                  </div>
                  <div>
                    <dt>Type</dt>
                    <dd>{selectedNode.type}</dd>
                  </div>
                  <div>
                    <dt>Position</dt>
                    <dd>
                      {selectedNode.position.x}, {selectedNode.position.y}
                    </dd>
                  </div>
                  <div>
                    <dt>Status</dt>
                    <dd>{selectedNode.status}</dd>
                  </div>
                  <div>
                    <dt>Role</dt>
                    <dd>{getNodeRole(selectedNode)}</dd>
                  </div>
                  <div>
                    <dt>Input schemas</dt>
                    <dd>{formatPortSchemas(selectedNode.ports.inputs)}</dd>
                  </div>
                  <div>
                    <dt>Output schemas</dt>
                    <dd>{formatPortSchemas(selectedNode.ports.outputs)}</dd>
                  </div>
                  <div>
                    <dt>Upstream dependencies</dt>
                    <dd>{selectedNodeUpstreamDependencies.join(", ") || "None"}</dd>
                  </div>
                  <div>
                    <dt>Packets seen</dt>
                    <dd>{selectedNodePacketActivity?.count ?? 0}</dd>
                  </div>
                </dl>
                {selectedNode.type === "Generator.Bluetooth" ? (
                  <div className="bluetooth-panel">
                    <p className="panel__subtext">
                      Stream vectors from a Web Bluetooth device or start a demo stream for testing.
                    </p>
                    <div className="action-grid">
                      <button
                        className="button"
                        type="button"
                        disabled={!browserBluetoothSupported()}
                        onClick={() => void startBluetoothStream("device")}
                      >
                        Connect Device
                      </button>
                      <button className="button" type="button" onClick={() => void startBluetoothStream("demo")}>
                        Start Demo Stream
                      </button>
                      <button className="button button--ghost" type="button" onClick={() => void stopBluetoothStream()}>
                        Stop Stream
                      </button>
                    </div>
                    <p className="empty-copy">{bluetoothStatus}</p>
                    {selectedNodePacketActivity ? (
                      <>
                        <div className="packet-bars" aria-label="Recent packet magnitudes">
                          {selectedNodePacketActivity.recentMagnitudes.map((value, index) => (
                            <span
                              key={`${selectedNode.id}_mag_${index}`}
                              className="packet-bars__bar"
                              style={{ height: `${Math.max(10, Math.min(100, value * 60))}%` }}
                            />
                          ))}
                        </div>
                        <pre className="packet-preview">
                          {JSON.stringify(selectedNodePacketActivity.lastPayload, null, 2)}
                        </pre>
                      </>
                    ) : null}
                  </div>
                ) : null}
                {selectedNode.type === "Modifier.Classifier" ? (
                  <div className="classifier-panel">
                    <p className="panel__subtext">
                      Record labeled vector samples, train a model, then switch to live inference.
                      Classifier outputs can now feed downstream fusion nodes for cooperative
                      decisions.
                    </p>
                    <dl className="meta-list">
                      <div>
                        <dt>Dataset labels</dt>
                        <dd>{classifierConfig?.labels.join(", ") || "None yet"}</dd>
                      </div>
                      <div>
                        <dt>Recorded samples</dt>
                        <dd>{classifierConfig?.sample_count ?? 0}</dd>
                      </div>
                      <div>
                        <dt>Model id</dt>
                        <dd>{classifierConfig?.model_id ?? "Not trained"}</dd>
                      </div>
                      <div>
                        <dt>Window size</dt>
                        <dd>{classifierConfig?.window_size ?? 8}</dd>
                      </div>
                      <div>
                        <dt>Latest prediction</dt>
                        <dd>{formatPrediction(selectedNodePacketActivity?.lastPayload).label}</dd>
                      </div>
                      <div>
                        <dt>Confidence</dt>
                        <dd>{formatPrediction(selectedNodePacketActivity?.lastPayload).confidence}</dd>
                      </div>
                    </dl>
                    <label className="form-grid">
                      <span>Recording label</span>
                      <input value={recordingLabel} onChange={(event) => setRecordingLabel(event.target.value)} />
                    </label>
                    <div className="action-grid">
                      <button className="button" type="button" onClick={handleClassifierRecordStart}>
                        Start Recording
                      </button>
                      <button className="button button--ghost" type="button" onClick={handleClassifierRecordStop}>
                        Stop Recording
                      </button>
                      <button className="button" type="button" onClick={handleClassifierTrain}>
                        Train Model
                      </button>
                    </div>
                    <div className="action-grid">
                      <button className="button" type="button" onClick={handleInferenceStart}>
                        Start Live Inference
                      </button>
                      <button className="button button--ghost" type="button" onClick={handleInferenceStop}>
                        Stop Live Inference
                      </button>
                    </div>
                    {selectedNodePacketActivity ? (
                      <pre className="packet-preview">
                        {JSON.stringify(selectedNodePacketActivity.lastPayload, null, 2)}
                      </pre>
                    ) : (
                      <p className="empty-copy">Inference output labels will appear here once packets flow through the classifier.</p>
                    )}
                  </div>
                ) : null}
                {selectedNode.type === "Modifier.Fusion" ? (
                  <div className="fusion-panel">
                    <p className="panel__subtext">
                      Combine intermediate model outputs within a short window to produce a
                      higher-level prediction for downstream consumers.
                    </p>
                    <dl className="meta-list">
                      <div>
                        <dt>Fusion window</dt>
                        <dd>{fusionConfig?.window_ms ?? 5000} ms</dd>
                      </div>
                      <div>
                        <dt>Rule</dt>
                        <dd>
                          {fusionConfig
                            ? `${fusionConfig.rule.left_label} + ${fusionConfig.rule.right_label} → ${fusionConfig.rule.output_label}`
                            : "No rule configured"}
                        </dd>
                      </div>
                      <div>
                        <dt>Latest prediction</dt>
                        <dd>{fusionConfig?.lastOutput?.label ?? "No fused output yet"}</dd>
                      </div>
                      <div>
                        <dt>Confidence</dt>
                        <dd>
                          {typeof fusionConfig?.lastOutput?.confidence === "number"
                            ? fusionConfig.lastOutput.confidence.toFixed(2)
                            : "Not available"}
                        </dd>
                      </div>
                    </dl>
                    <div className="form-grid">
                      <label>
                        <span>Left model label</span>
                        <input
                          value={fusionConfig?.rule.left_label ?? ""}
                          onChange={(event) => handleFusionRuleChange("left_label", event.target.value)}
                        />
                      </label>
                      <label>
                        <span>Right model label</span>
                        <input
                          value={fusionConfig?.rule.right_label ?? ""}
                          onChange={(event) => handleFusionRuleChange("right_label", event.target.value)}
                        />
                      </label>
                      <label>
                        <span>Output label</span>
                        <input
                          value={fusionConfig?.rule.output_label ?? ""}
                          onChange={(event) => handleFusionRuleChange("output_label", event.target.value)}
                        />
                      </label>
                      <label>
                        <span>Rule confidence</span>
                        <input
                          type="number"
                          min="0"
                          max="0.99"
                          step="0.01"
                          value={fusionConfig?.rule.confidence ?? 0.95}
                          onChange={(event) => handleFusionRuleChange("confidence", event.target.value)}
                        />
                      </label>
                      <label>
                        <span>Window ms</span>
                        <input
                          type="number"
                          min="250"
                          step="250"
                          value={fusionConfig?.window_ms ?? 5000}
                          onChange={(event) => handleFusionWindowChange(event.target.value)}
                        />
                      </label>
                    </div>
                    {fusionConfig?.diagnostic ? (
                      <p className="empty-copy">Diagnostic: {fusionConfig.diagnostic}</p>
                    ) : null}
                    {fusionConfig?.latestInputs.length ? (
                      <div className="status-list">
                        <div className="status-list__header">
                          <h3>Latest Inputs</h3>
                          <span className="pill">{fusionConfig.latestInputs.length} ports ready</span>
                        </div>
                        {fusionConfig.latestInputs.map((input) => (
                          <article key={`${selectedNode.id}_${input.port}`} className="status-row">
                            <div className="status-row__header">
                              <strong>{input.port}</strong>
                              <span className="pill">
                                {typeof input.confidence === "number"
                                  ? `Confidence ${input.confidence.toFixed(2)}`
                                  : "Confidence n/a"}
                              </span>
                            </div>
                            <p className="status-row__meta">
                              {input.sourceNodeId ? `Source ${input.sourceNodeId}` : "Source unknown"}
                            </p>
                            <p>{input.label}</p>
                          </article>
                        ))}
                      </div>
                    ) : (
                      <p className="empty-copy">
                        Intermediate predictions from upstream models will appear here as each fusion
                        port receives packets.
                      </p>
                    )}
                    {selectedNodePacketActivity ? (
                      <pre className="packet-preview">
                        {JSON.stringify(selectedNodePacketActivity.lastPayload, null, 2)}
                      </pre>
                    ) : null}
                  </div>
                ) : null}
                {selectedNode.type === "Consumer.Spotify" ? (
                  <div className="spotify-panel">
                    <p className="panel__subtext">
                      Trigger a Spotify playback command from routed labels while the UI reconciles
                      local edits with canonical node state.
                    </p>
                    <dl className="meta-list">
                      <div>
                        <dt>Configured action</dt>
                        <dd>{getSpotifyActionLabel(spotifyState?.configuredAction ?? "next_track")}</dd>
                      </div>
                      <div>
                        <dt>Auth state</dt>
                        <dd>{spotifyState?.authStatus ?? "Unknown"}</dd>
                      </div>
                      <div>
                        <dt>Connection state</dt>
                        <dd>{spotifyState?.connectionStatus ?? "Unknown"}</dd>
                      </div>
                      <div>
                        <dt>Account</dt>
                        <dd>{spotifyState?.accountLabel ?? "Not surfaced"}</dd>
                      </div>
                    </dl>
                    <label className="form-grid">
                      <span>Spotify action</span>
                      <select
                        value={spotifyState?.action ?? "next_track"}
                        onChange={(event) => handleSpotifyActionChange(event.target.value as SpotifyAction)}
                      >
                        {SPOTIFY_ACTIONS.map((action) => (
                          <option key={action} value={action}>
                            {getSpotifyActionLabel(action)}
                          </option>
                        ))}
                      </select>
                    </label>
                    <div className="action-grid">
                      <button className="button" type="button" onClick={handleSpotifyConnect}>
                        {spotifyState?.isConnected
                          ? "Reconnect Spotify"
                          : spotifyState?.requiresAuthorization
                            ? "Resume Spotify Setup"
                            : "Connect Spotify"}
                      </button>
                      <button className="button button--ghost" type="button" onClick={handleSpotifyAuthStateRefresh}>
                        Refresh Auth State
                      </button>
                    </div>
                    {spotifyState?.lastErrorMessage ? (
                      <p className="empty-copy">Last error: {spotifyState.lastErrorMessage}</p>
                    ) : null}
                    {spotifyState?.authorizationUrl ? (
                      <p className="empty-copy">
                        Authorization required:{" "}
                        <a href={spotifyState.authorizationUrl} target="_blank" rel="noreferrer">
                          Open Spotify Authorization
                        </a>
                      </p>
                    ) : null}
                    {spotifyState?.unsupportedAction ? (
                      <p className="empty-copy">
                        Canonical graph sent unsupported action <code>{spotifyState.unsupportedAction}</code>.
                        Saving from this inspector will replace it with a supported action.
                      </p>
                    ) : null}
                    <div className="status-list">
                      <div className="status-list__header">
                        <h3>Recent Spotify Actions</h3>
                        <span className="pill">
                          {spotifyState?.lastAttempt
                            ? humanizeStatus(spotifyState.lastAttempt.status)
                            : "No attempts"}
                        </span>
                      </div>
                      {spotifyState?.history.length ? (
                        spotifyState.history.map((entry, index) => (
                          <article key={`${selectedNode.id}_spotify_${index}`} className="status-row">
                            <div className="status-row__header">
                              <strong>{getSpotifyActionLabel(entry.action)}</strong>
                              <span className={`pill pill--status ${statusToneClass(entry.status)}`}>
                                {humanizeStatus(entry.status)}
                              </span>
                            </div>
                            <p className="status-row__meta">
                              {formatAttemptTimestamp(entry.timestamp)}
                              {entry.requestId ? ` · ${entry.requestId}` : ""}
                            </p>
                            <p>{entry.message ?? "No result details provided by canonical graph."}</p>
                          </article>
                        ))
                      ) : (
                        <p className="empty-copy">
                          Canonical Spotify action history will appear here after the execution engine
                          reports attempts.
                        </p>
                      )}
                    </div>
                    {selectedNodePacketActivity ? (
                      <pre className="packet-preview">
                        {JSON.stringify(selectedNodePacketActivity.lastPayload, null, 2)}
                      </pre>
                    ) : null}
                  </div>
                ) : null}
                <div className="action-grid">
                  <button className="button button--danger" type="button" onClick={handleDeleteSelectedNode}>
                    Delete Node
                  </button>
                </div>
              </>
            ) : (
              <p className="empty-copy">Select a node on the canvas to inspect it here.</p>
            )}
          </section>

          <section className="panel">
            <div className="panel__header">
              <div>
                <h2>Project Snapshot</h2>
                <p className="panel__subtext">
                  Current graph metadata, nodes, and edges from the orchestrator.
                </p>
              </div>
            </div>

            {graph ? (
              <>
                <dl className="meta-list">
                  <div>
                    <dt>Name</dt>
                    <dd>{graph.project.name}</dd>
                  </div>
                  <div>
                    <dt>Version</dt>
                    <dd>{graph.project.version}</dd>
                  </div>
                  <div>
                    <dt>Nodes</dt>
                    <dd>{graph.nodes.length}</dd>
                  </div>
                  <div>
                    <dt>Edges</dt>
                    <dd>{graph.edges.length}</dd>
                  </div>
                </dl>

                <ul className="node-list">
                  {graph.nodes.length === 0 ? (
                    <li className="node-list__empty">The orchestrator returned an empty graph.</li>
                  ) : (
                    graph.nodes.map((node) => (
                      <li
                        key={node.id}
                        className={`node-card ${node.id === selectedNodeId ? "node-card--selected" : ""}`}
                      >
                        <div className="node-card__header">
                          <strong>{node.label}</strong>
                          <span className={`pill pill--status pill--${node.status}`}>{node.status}</span>
                        </div>
                        <p>{node.type}</p>
                        <p>
                          Position {node.position.x}, {node.position.y}
                        </p>
                        {packetActivity[node.id] ? <p>{packetActivity[node.id].count} packets observed</p> : null}
                        {node.type === "Modifier.Classifier" ? (
                          <p>Samples {getClassifierConfig(node)?.sample_count ?? 0}</p>
                        ) : null}
                        {node.type === "Modifier.Fusion" ? (
                          <p>{getFusionConfig(node)?.nodeSummary ?? "Waiting for model outputs"}</p>
                        ) : null}
                        {node.type === "Consumer.Spotify" ? <p>{getSpotifyConsumerState(node).nodeSummary}</p> : null}
                      </li>
                    ))
                  )}
                </ul>

                <div className="edge-list">
                  <h3>Edges</h3>
                  {graph.edges.length === 0 ? (
                    <p className="empty-copy">No edges yet.</p>
                  ) : (
                    graph.edges.map((edge) => (
                      <div key={edge.id} className="edge-row">
                        <div>
                          <strong>{edge.id}</strong>
                          <p>
                            {edge.source_id}:{edge.source_port} → {edge.target_id}:{edge.target_port}
                          </p>
                        </div>
                        <button className="button button--ghost" type="button" onClick={() => handleDeleteEdge(edge.id)}>
                          Remove
                        </button>
                      </div>
                    ))
                  )}
                </div>
              </>
            ) : (
              <p className="empty-copy">
                Waiting for a canonical graph snapshot from the backend. Once connected, the
                canvas will update from `graph:init` or `graph:updated` events.
              </p>
            )}
          </section>

          {viewState.lastError ? (
            <section className="panel panel--error">
              <div className="panel__header">
                <div>
                  <h2>Server Error</h2>
                  <p className="panel__subtext">Validation and contract errors should surface here.</p>
                </div>
              </div>
              <p>
                <strong>{viewState.lastError.code}</strong>: {viewState.lastError.message}
              </p>
              <pre className="error-details">
                {JSON.stringify(viewState.lastError.details, null, 2)}
              </pre>
            </section>
          ) : null}
        </aside>
      </main>
    </div>
  );
}

function defaultSocketPath() {
  if (typeof window === "undefined") {
    return "ws://localhost:4000/socket";
  }

  const protocol = window.location.protocol === "https:" ? "wss" : "ws";
  return `${protocol}://localhost:4000/socket`;
}

function formatPushError(resp: unknown, fallback: string) {
  if (typeof resp === "string") {
    return resp;
  }

  if (resp !== null && typeof resp === "object") {
    try {
      return JSON.stringify(resp);
    } catch {
      return fallback;
    }
  }

  return fallback;
}

function nextNodePosition(graph: GraphSnapshot) {
  const index = graph.nodes.length;

  return {
    x: 80 + (index % 4) * 220,
    y: 80 + Math.floor(index / 4) * 140,
  };
}

function failPendingRequest(
  state: typeof initialGraphViewState,
  requestId: string,
  message: string,
) {
  const pendingRequestIds = state.pendingRequestIds.filter((value) => value !== requestId);

  return {
    ...state,
    draftGraph: pendingRequestIds.length === 0 ? null : state.draftGraph,
    pendingRequestIds,
    lastError: {
      code: "request_failed",
      message,
      details: {},
    },
  };
}

function getClassifierConfig(node: GraphNode) {
  const raw = node.configuration.classifier;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return null;
  }

  const classifier = raw as Record<string, unknown>;
  const dataset =
    classifier.dataset && typeof classifier.dataset === "object" && !Array.isArray(classifier.dataset)
      ? (classifier.dataset as Record<string, unknown>)
      : {};

  const labels = Array.isArray(dataset.labels)
    ? dataset.labels.filter((value): value is string => typeof value === "string")
    : [];
  const samples = Array.isArray(dataset.samples) ? dataset.samples.length : 0;

  return {
    labels,
    sample_count: samples,
    model_id: typeof classifier.model_id === "string" ? classifier.model_id : null,
    window_size: typeof classifier.window_size === "number" ? classifier.window_size : 8,
    epochs: typeof classifier.epochs === "number" ? classifier.epochs : 20,
  };
}

function getNodeCanvasStatusText(node: GraphNode) {
  if (node.type === "Modifier.Fusion") {
    return getFusionConfig(node)?.nodeSummary ?? null;
  }

  if (node.type !== "Consumer.Spotify") {
    return null;
  }

  return getSpotifyConsumerState(node).nodeSummary;
}

function getFusionConfig(node: GraphNode) {
  const raw = node.configuration.fusion;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return null;
  }

  const fusion = raw as Record<string, unknown>;
  const rules = Array.isArray(fusion.rules)
    ? fusion.rules.map((rule) => getRecord(rule))
    : [];
  const rule = rules[0] ?? {};
  const latestInputsRecord = getRecord(fusion.latest_inputs);
  const latestInputs = Object.entries(latestInputsRecord).map(([port, value]) => {
    const input = getRecord(value);
    return {
      port,
      label: typeof input.label === "string" ? input.label : "Unknown",
      confidence: typeof input.confidence === "number" ? input.confidence : null,
      sourceNodeId: typeof input.source_node_id === "string" ? input.source_node_id : null,
    };
  });
  const lastOutput = getRecord(fusion.last_output);
  const lastError = getRecord(fusion.last_error);
  const nodeSummary =
    typeof lastOutput.label === "string"
      ? `Fused ${lastOutput.label}`
      : typeof lastError.message === "string"
        ? lastError.message
        : "Waiting for inputs";

  return {
    window_ms: typeof fusion.window_ms === "number" ? fusion.window_ms : 5000,
    rule: {
      left_label: typeof rule.left_label === "string" ? rule.left_label : "",
      right_label: typeof rule.right_label === "string" ? rule.right_label : "",
      output_label: typeof rule.output_label === "string" ? rule.output_label : "",
      confidence: typeof rule.confidence === "number" ? rule.confidence : 0.95,
    },
    latestInputs,
    lastOutput:
      typeof lastOutput.label === "string"
        ? {
            label: lastOutput.label,
            confidence: typeof lastOutput.confidence === "number" ? lastOutput.confidence : null,
          }
        : null,
    diagnostic: typeof lastError.message === "string" ? lastError.message : null,
    nodeSummary,
  };
}

function getUpstreamDependencies(graph: GraphSnapshot, nodeId: string) {
  return graph.edges
    .filter((edge) => edge.target_id === nodeId)
    .map((edge) => {
      const source = graph.nodes.find((node) => node.id === edge.source_id);
      return source ? `${source.label}:${edge.source_port}` : `${edge.source_id}:${edge.source_port}`;
    });
}

function formatPortSchemas(ports: GraphNode["ports"]["inputs"] | GraphNode["ports"]["outputs"]) {
  return ports.length ? ports.map((port) => `${port.name} (${port.schema})`).join(", ") : "None";
}

function getNodeRole(node: GraphNode) {
  if (node.type === "Modifier.Classifier") {
    return "Model node";
  }

  if (node.type === "Modifier.Fusion") {
    return "Fusion node";
  }

  if (node.type.startsWith("Generator.")) {
    return "Sensor/source node";
  }

  if (node.type.startsWith("Consumer.")) {
    return "Action node";
  }

  return `${node.category} node`;
}

function formatPrediction(payload: Record<string, unknown> | undefined) {
  const label = typeof payload?.label === "string" ? payload.label : "No prediction yet";
  const confidence =
    typeof payload?.confidence === "number" ? payload.confidence.toFixed(2) : "Not available";

  return { label, confidence };
}

function getRecord(value: unknown): Record<string, unknown> {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  return {};
}

function humanizeStatus(value: string) {
  return value
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function statusToneClass(status: string) {
  const normalized = status.trim().toLowerCase();

  if (normalized.includes("fail") || normalized.includes("error")) {
    return "pill--failed";
  }

  if (normalized.includes("pending") || normalized.includes("queue") || normalized.includes("running")) {
    return "pill--pending";
  }

  if (normalized.includes("success") || normalized.includes("ok") || normalized.includes("complete")) {
    return "pill--ready";
  }

  return "";
}

function formatAttemptTimestamp(timestamp: string | null) {
  if (!timestamp) {
    return "Timestamp unavailable";
  }

  const parsed = new Date(timestamp);
  if (Number.isNaN(parsed.valueOf())) {
    return timestamp;
  }

  return parsed.toLocaleString();
}
