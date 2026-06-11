import { describe, expect, it } from "vitest";

import { renderApprovalEntry } from "../src/features/chat/ApprovalEntry";
import { renderArtifactChip } from "../src/features/chat/ArtifactChip";
import { renderChatPage } from "../src/features/chat/ChatPage";
import { renderDelegationEntry } from "../src/features/chat/DelegationEntry";
import { renderTaskRootCard } from "../src/features/chat/TaskRootCard";
import { renderThreadPanel } from "../src/features/chat/ThreadPanel";
import { renderComputersPage } from "../src/features/computers/ComputersPage";
import { renderDiagnosticsPage } from "../src/features/diagnostics/DiagnosticsPage";
import { renderMembersPage } from "../src/features/members/MembersPage";
import { renderNotificationCenter } from "../src/features/notifications/NotificationCenter";
import { renderOnboardingPage } from "../src/features/onboarding/OnboardingPage";
import { renderSettingsPage } from "../src/features/settings/SettingsPage";
import { renderTasksPage } from "../src/features/tasks/TasksPage";
import { sanitizeMarkdown } from "../src/lib/markdown";

describe("Slei MVP acceptance", () => {
  it("covers onboarding setup chat task thread delegation approval board artifacts and bilingual flows", () => {
    const onboarding = renderOnboardingPage({
      locale: "zh-CN",
      hasProfile: false,
      daemonConnected: true,
      runtimeReady: true,
    });
    const members = renderMembersPage({
      locale: "zh-CN",
      agents: [
        {
          name: "Guide",
          handle: "guide",
          runtimeKind: "ClaudeCode",
          model: "sonnet",
          presence: "online",
          permission: "Controlled",
        },
      ],
      humans: [{ name: "lei lee", handle: "lei-lee" }],
    });
    const chat = renderChatPage({
      locale: "zh-CN",
      channel: { name: "dev-team" },
      messages: [{ sender: "lei lee", body: "@guide 帮我搭项目", streaming: false, toolCalls: [] }],
      composer: { asTask: true },
      lastSequence: 7,
    });
    const taskCard = renderTaskRootCard({
      title: "多工作区任务",
      status: "in_progress",
      replyCount: 2,
      unread: true,
      assignee: "Guide",
    });
    const thread = renderThreadPanel({
      channelName: "dev-team",
      taskTitle: "多工作区任务",
      status: "in_progress",
      replies: [{ sender: "Guide", body: "需要 @Alice 继续" }],
    });
    const delegation = renderDelegationEntry({
      from: "Guide",
      to: "Alice",
      taskTitle: "多工作区任务",
      pending: true,
    });
    const approval = renderApprovalEntry({
      taskTitle: "多工作区任务",
      action: "Write src/main.ts",
      risk: "Controlled",
      pending: true,
    });
    const board = renderTasksPage({
      locale: "zh-CN",
      view: "board",
      filters: { channel: "dev-team", assignee: "Guide" },
      tasks: [
        {
          id: "task_1",
          sequence: 1,
          channelName: "dev-team",
          creator: "lei lee",
          assignee: "Guide",
          title: "多工作区任务",
          status: "in_progress",
          attentionRequired: true,
        },
      ],
    });
    const artifact = renderArtifactChip({
      id: "artifact_1",
      channelName: "dev-team",
      taskTitle: "多工作区任务",
      runId: "run_1",
      displayName: "summary.md",
      contentHash: "hash_safe",
    });
    const settings = renderSettingsPage({
      locale: "en-US",
      profile: { nickname: "Lei", handle: "lei-lee", bio: "builder" },
      notifications: { mentions: true, humanReplies: true, approvals: true },
    });

    expect(onboarding).toContain("欢迎使用 Slei");
    expect(members).toContain("Guide");
    expect(chat).toContain("@guide");
    expect(taskCard).toContain("2 replies");
    expect(thread).toContain("@Alice");
    expect(delegation).toContain("Guide → Alice");
    expect(approval).toContain("等待审批");
    expect(board).toContain("需要用户关注");
    expect(artifact).toContain("artifact_1");
    expect(settings).toContain("Settings");
  });

  it("covers local-only daemon boundary deletion non-recovery reconnect and markdown safety", () => {
    const computers = renderComputersPage({
      locale: "zh-CN",
      nodes: [
        {
          id: "node_1",
          name: "MacBook",
          status: "connected",
          daemonVersion: "0.1.0",
          runtimes: [{ kind: "ClaudeCode", readiness: "ready" }],
          agents: [],
        },
      ],
    });
    const notifications = renderNotificationCenter({
      locale: "zh-CN",
      notifications: [{ taskTitle: "多工作区任务", payload: "@lei-lee 请确认", read: false }],
    });
    const diagnostics = renderDiagnosticsPage({
      locale: "zh-CN",
      status: {
        node: "MacBook",
        runtime: "Claude Code",
        worker: "claude-agent",
        protocolVersion: "v1",
        schemaVersion: "2026-05-27",
        failureSummary: "token=[redacted-token]",
      },
    });

    expect(computers).toContain("运行设备");
    expect(computers).not.toContain("server-url");
    expect(notifications).toContain("@lei-lee");
    expect(diagnostics).toContain("[redacted-token]");
    expect(sanitizeMarkdown("[bad](javascript:alert(1)) [file](file:///etc/passwd)")).toBe(
      "[bad](#blocked) [file](#blocked)",
    );
  });
});
