import type { SocketConnectionStatus } from "../lib/projectChannel";

const LABELS: Record<SocketConnectionStatus, string> = {
  disconnected: "Disconnected",
  connecting: "Connecting…",
  ready: "Connected",
  error: "Error",
};

export function ConnectionStatus(props: {
  status: SocketConnectionStatus;
  detail?: string;
}) {
  const { status, detail } = props;
  return (
    <div className="connection-status" data-status={status}>
      <span className="connection-status__dot" aria-hidden />
      <span className="connection-status__label">{LABELS[status]}</span>
      {detail ? <span className="connection-status__detail">{detail}</span> : null}
    </div>
  );
}
