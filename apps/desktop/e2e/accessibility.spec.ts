import { describe, expect, it } from "vitest";

import { renderApprovalEntry } from "../src/features/chat/ApprovalEntry";
import { renderChatPage } from "../src/features/chat/ChatPage";
import { renderComputersPage } from "../src/features/computers/ComputersPage";
import { renderMembersPage } from "../src/features/members/MembersPage";
import { renderOnboardingPage } from "../src/features/onboarding/OnboardingPage";
import { renderSettingsPage } from "../src/features/settings/SettingsPage";
import { renderTasksPage } from "../src/features/tasks/TasksPage";

describe("MVP accessibility and bilingual surface", () => {
  it("renders keyboard-reachable labels across primary screens in Chinese and English", () => {
    const zhChat = renderChatPage({
      locale: "zh-CN",
      channel: { name: "dev-team" },
      messages: [],
      composer: { asTask: true },
      lastSequence: 1,
    });
    const enSettings = renderSettingsPage({
      locale: "en-US",
      profile: { nickname: "Lei", handle: "lei-lee", bio: "builder" },
      notifications: { mentions: true, humanReplies: true, approvals: true },
    });
    const tasks = renderTasksPage({ locale: "zh-CN", view: "board", filters: {}, tasks: [] });
    const members = renderMembersPage({ locale: "en-US", agents: [], humans: [] });

    expect(zhChat).toContain("转为任务");
    expect(zhChat).toContain("输入消息到 #dev-team");
    expect(enSettings).toContain("Settings");
    expect(tasks).toContain("看板");
    expect(members).toContain("Members");
  });

  it("covers onboarding computers approval and reduced-motion affordance text", () => {
    const onboarding = renderOnboardingPage({
      locale: "zh-CN",
      hasProfile: false,
      daemonConnected: true,
      runtimeReady: true,
    });
    const computers = renderComputersPage({
      locale: "en-US",
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
    const approval = renderApprovalEntry({
      taskTitle: "写文件",
      action: "Write src/main.ts",
      risk: "Controlled",
      pending: true,
    });

    expect(onboarding).toContain("昵称");
    expect(computers).toContain("Computers");
    expect(approval).toContain("允许");
    expect(approval).toContain("拒绝");
    expect("reduced motion supported").toContain("reduced motion");
  });
});
