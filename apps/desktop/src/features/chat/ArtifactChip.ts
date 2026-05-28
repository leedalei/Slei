export type ArtifactView = {
  id: string;
  channelName: string;
  taskTitle: string;
  runId: string;
  displayName: string;
  contentHash: string;
};

export function renderArtifactChip(artifact: ArtifactView): string {
  return [
    "Artifact",
    artifact.displayName,
    artifact.id,
    `Run: ${artifact.runId}`,
    `Hash: ${artifact.contentHash}`,
    "Open via daemon",
  ].join(" ");
}
