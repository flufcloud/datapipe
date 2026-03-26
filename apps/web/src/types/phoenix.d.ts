declare module "phoenix" {
  export type ReceiveStatus = "ok" | "error" | "timeout";

  export interface Push {
    receive(status: ReceiveStatus, callback: (response: unknown) => void): Push;
  }

  export interface Channel {
    join(): Push;
    leave(): Push;
    on(event: string, callback: (payload: unknown) => void): void;
    onError(callback: (reason?: unknown) => void): void;
    push(event: string, payload: Record<string, unknown>): Push;
  }

  export interface SocketOptions {
    params?: Record<string, unknown>;
    reconnectAfterMs?: (tries: number) => number;
  }

  export class Socket {
    constructor(endPoint: string, opts?: SocketOptions);
    connect(): void;
    disconnect(callback?: () => void, code?: number, reason?: string): void;
    channel(topic: string, params?: Record<string, unknown>): Channel;
    onError(callback: (error?: unknown) => void): void;
    onClose(callback: (event?: unknown) => void): void;
  }
}
