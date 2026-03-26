import type { GraphSnapshot } from "../types/graph";
import type { ProjectChannelPush } from "../types/websocket";
import { isErrorMessage, isGraphSyncMessage } from "../types/websocket";

export type ServerError = {
  code: string;
  message: string;
  details: Record<string, unknown>;
};

export type GraphViewState = {
  /** Last canonical snapshot from the orchestrator (never authoritative for mutations). */
  canonicalGraph: GraphSnapshot | null;
  /** Optional local draft reserved for optimistic UI that must reconcile with the server. */
  draftGraph: GraphSnapshot | null;
  pendingRequestIds: string[];
  lastServerRequestId: string | null;
  lastError: ServerError | null;
};

export const initialGraphViewState: GraphViewState = {
  canonicalGraph: null,
  draftGraph: null,
  pendingRequestIds: [],
  lastServerRequestId: null,
  lastError: null,
};

export function getRenderableGraph(state: GraphViewState): GraphSnapshot | null {
  return state.draftGraph ?? state.canonicalGraph;
}

export function stageLocalGraphDraft(
  prev: GraphViewState,
  draftGraph: GraphSnapshot,
  requestId: string,
): GraphViewState {
  return {
    ...prev,
    draftGraph,
    pendingRequestIds: appendRequestId(prev.pendingRequestIds, requestId),
    lastError: null,
  };
}

/**
 * Applies a server-originated message. Callers should only pass pushes the server sent
 * (broadcasts or replies), not optimistic local edits.
 */
export function reduceGraphViewState(
  prev: GraphViewState,
  message: ProjectChannelPush,
): GraphViewState {
  if (isErrorMessage(message)) {
    const pendingRequestIds = removeRequestId(prev.pendingRequestIds, message.request_id);
    return {
      ...prev,
      draftGraph: pendingRequestIds.length === 0 ? null : prev.draftGraph,
      pendingRequestIds,
      lastError: message.payload,
      lastServerRequestId: message.request_id,
    };
  }

  if (isGraphSyncMessage(message)) {
    const pendingRequestIds = removeRequestId(prev.pendingRequestIds, message.request_id);
    return {
      canonicalGraph: message.payload.graph,
      draftGraph: pendingRequestIds.length === 0 ? null : prev.draftGraph,
      pendingRequestIds,
      lastServerRequestId: message.request_id,
      lastError: null,
    };
  }

  return prev;
}

function appendRequestId(existing: string[], requestId: string): string[] {
  return existing.includes(requestId) ? existing : [...existing, requestId];
}

function removeRequestId(existing: string[], requestId: string): string[] {
  return existing.filter((value) => value !== requestId);
}
