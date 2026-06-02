import type { SleiMessage } from "../app/fixtures";

export function MessageStatusSquare({ status }: { status?: SleiMessage["status"] }) {
  const tone = messageStatusSquare(status);
  if (!tone) return null;
  return (
    <span
      aria-label={status}
      className={`slei-message-status-square slei-message-status-square--${tone}`}
      role="img"
      title={status}
    />
  );
}

export function StatusDot({ status }: { status: "idle" | "busy" | "offline" }) {
  return <span aria-label={status} className={`slei-status-dot slei-status-dot--${status}`} role="img" />;
}

function messageStatusSquare(status?: SleiMessage["status"]): "running" | "approval" | "failed" | "pending" | undefined {
  if (status === "running") return "running";
  if (status === "approval") return "approval";
  if (status === "failed") return "failed";
  if (status === "pending" || status === "undecided") return "pending";
  return undefined;
}
