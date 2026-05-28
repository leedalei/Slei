import { type ArtifactView, renderArtifactChip } from "./ArtifactChip";

export function renderFilesTab(input: { channelName: string; artifacts: ArtifactView[] }): string {
  if (input.artifacts.length === 0) {
    return `FILES #${input.channelName} No files`;
  }

  return [
    `FILES #${input.channelName}`,
    ...input.artifacts.map((artifact) =>
      [artifact.taskTitle, renderArtifactChip(artifact)].join(" "),
    ),
  ].join("\n");
}
