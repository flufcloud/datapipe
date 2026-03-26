import { Socket, type Channel } from "phoenix";
import { isGraphSnapshot } from "../types/graph";
import type { ProjectClientEvent } from "../types/websocket";
import { parseProjectChannelPayload } from "./parseChannelPayload";

export type SocketConnectionStatus =
  | "disconnected"
  | "connecting"
  | "ready"
  | "error";

export type ProjectChannelHandlers = {
  onStatus: (status: SocketConnectionStatus, detail?: string) => void;
  onMessage: (channelEvent: string, rawPayload: unknown) => void;
};

export type ProjectChannelOptions = {
  /** WebSocket base, e.g. ws://localhost:4000/socket or /socket when proxied */
  socketPath: string;
  projectId: string;
  handlers: ProjectChannelHandlers;
  socketParams?: Record<string, unknown>;
};

const GRAPH_EVENTS = ["graph:init", "graph:updated", "packet:observed", "error"] as const;

export type ProjectChannelConnection = {
  disconnect: () => void;
  channel: Channel;
};

/**
 * Subscribes to Phoenix topic `project:{projectId}` and forwards pushes.
 * Outbound mutations use `{ request_id, project_id, payload }` under the Phoenix push name.
 */
export function connectProjectChannel(options: ProjectChannelOptions): ProjectChannelConnection {
  const { socketPath, projectId, handlers, socketParams = {} } = options;
  const topic = `project:${projectId}`;

  handlers.onStatus("connecting");

  const socket = new Socket(socketPath, {
    params: socketParams,
    reconnectAfterMs: (tries: number) => [1000, 2000, 5000, 10000][tries - 1] ?? 10000,
  });

  socket.connect();

  const channel = socket.channel(topic, {});

  for (const ev of GRAPH_EVENTS) {
    channel.on(ev, (payload: unknown) => {
      handlers.onMessage(ev, payload);
    });
  }

  socket.onError(() => {
    handlers.onStatus("error", "socket transport error");
  });

  channel.onError(() => {
    handlers.onStatus("error", "channel error");
  });

  socket.onClose(() => {
    handlers.onStatus("disconnected");
  });

  channel
    .join()
    .receive("ok", (resp: unknown) => {
      handlers.onStatus("ready");
      if (resp !== null && typeof resp === "object") {
        const r = resp as Record<string, unknown>;
        if (isGraphSnapshot(r.graph)) {
          handlers.onMessage("graph:init", {
            request_id: "phx_join",
            project_id: projectId,
            payload: { graph: r.graph },
          });
        }
      }
    })
    .receive("error", (resp: unknown) => {
      handlers.onStatus("error", typeof resp === "string" ? resp : JSON.stringify(resp));
    })
    .receive("timeout", () => {
      handlers.onStatus("error", "join timeout");
    });

  const disconnect = () => {
    channel.leave();
    socket.disconnect();
    handlers.onStatus("disconnected");
  };

  return { disconnect, channel };
}

export function pushMutation(
  channel: Channel,
  event: ProjectClientEvent,
  projectId: string,
  requestId: string,
  payload: Record<string, unknown>,
) {
  return channel.push(event, {
    event,
    request_id: requestId,
    project_id: projectId,
    payload,
  });
}

export function requestInitialGraph(
  channel: Channel,
  projectId: string,
  requestId: string,
) {
  return pushMutation(channel, "graph:init", projectId, requestId, {});
}

export { parseProjectChannelPayload };
