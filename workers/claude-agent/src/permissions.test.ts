import { describe, expect, it } from "vitest";

import {
  CLAUDE_ALLOWED_TOOLS,
  CLAUDE_CLI_TOOLS,
  CLAUDE_DISALLOWED_TOOLS,
  CLAUDE_SETTING_SOURCES,
  permissionModeForCli,
} from "./claude-cli.js";

describe("Slei Claude CLI static permission profile", () => {
  it("allows read tools and Slei product MCP tools", () => {
    expect(CLAUDE_CLI_TOOLS).toEqual([
      "Skill",
      "Read",
      "Grep",
      "Glob",
      "LS",
      "Write",
      "Edit",
      "MultiEdit",
    ]);
    expect(CLAUDE_ALLOWED_TOOLS).toEqual([
      "Skill",
      "Read",
      "Grep",
      "Glob",
      "LS",
      "mcp__slei__slei_propose_interactive_card",
      "mcp__slei__slei_request_visible_delegation",
      "mcp__slei__slei_request_human_reply",
    ]);
  });

  it("disallows delegated workers, plugins, and network download commands", () => {
    expect(CLAUDE_DISALLOWED_TOOLS).toEqual([
      "Task",
      "Plugin:*",
      "Bash:curl",
      "Bash:wget",
    ]);
  });

  it("uses default Claude CLI permission mode with local settings sources", () => {
    expect(CLAUDE_SETTING_SOURCES).toEqual(["user", "project", "local"]);
    expect(permissionModeForCli()).toBe("default");
  });
});
