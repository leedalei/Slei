import { createDesktopMessages } from "../../i18n";
import { type ArtifactView, renderArtifactChip } from "./ArtifactChip";

export function renderFilesTab(input: { channelName: string; artifacts: ArtifactView[]; locale?: "zh-CN" | "en-US" }): string {
  const locale = input.locale ?? "en-US";
  const messages = createDesktopMessages(locale).chat;
  if (input.artifacts.length === 0) {
    return `${messages.files.toUpperCase()} #${input.channelName} ${messages.noFiles}`;
  }

  return [
    `${messages.files.toUpperCase()} #${input.channelName}`,
    ...input.artifacts.map((artifact) =>
      [artifact.taskTitle, renderArtifactChip(artifact, locale)].join(" "),
    ),
  ].join("\n");
}
