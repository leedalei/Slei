import { describe, expect, it } from "vitest";

import { renderArtifactChip } from "../src/features/chat/ArtifactChip";
import { renderFilesTab } from "../src/features/chat/FilesTab";
import { sanitizeMarkdown } from "../src/lib/markdown";

describe("artifact files views", () => {
  const artifact = {
    id: "artifact_1",
    channelName: "dev-team",
    taskTitle: "帮我调研",
    runId: "run_1",
    displayName: "answer.md",
    contentHash: "hash_safe",
  };

  it("renders guarded artifact chips and task files tab from metadata", () => {
    const chip = renderArtifactChip(artifact);
    expect(chip).toContain("answer.md");
    expect(chip).toContain("artifact_1");
    expect(chip).not.toContain("/Users/");

    const tab = renderFilesTab({ channelName: "dev-team", artifacts: [artifact] });
    expect(tab).toContain("FILES");
    expect(tab).toContain("#dev-team");
    expect(tab).toContain("帮我调研");
    expect(tab).toContain("hash_safe");
  });

  it("blocks markdown local file opens instead of treating links as artifacts", () => {
    expect(sanitizeMarkdown("[local](file:///etc/passwd) [raw](/Users/lei/secret.md)")).toBe(
      "[local](#blocked) [raw](#blocked)",
    );
  });
});
