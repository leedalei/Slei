export type ArtifactView = {
  id: string;
  channelName: string;
  taskTitle: string;
  runId: string;
  displayName: string;
  contentHash: string;
};

export function renderArtifactChip(artifact: ArtifactView, locale: "zh-CN" | "en-US" = "en-US"): string {
  const messages = createDesktopMessages(locale).chat;
  return [
    messages.artifact,
    artifact.displayName,
    artifact.id,
    `${messages.run}: ${artifact.runId}`,
    `${messages.hash}: ${artifact.contentHash}`,
    messages.openViaDaemon,
  ].join(" ");
}
import { createDesktopMessages } from "../../i18n";
