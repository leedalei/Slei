import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { createChannelAgentActivityMessages, SleiAppFrame } from "../src/app/SleiApp";
import { createDemoMembers, createSleiFixtures } from "../src/test/fixtures";

function sendButtonMarkup(html: string) {
  return html.match(/<button\b(?=[^>]*data-testid="slei-send-button")[^>]*>/)?.[0] ?? "";
}

describe("Slei React desktop shell", () => {
  it("does not seed real channel timelines with demo messages", () => {
    const data = createSleiFixtures();

    expect(data.messages).toEqual([]);
  });

  it("defaults to the Chat home page with semantic desktop navigation", () => {
    const html = renderToStaticMarkup(
      <SleiAppFrame
        activeView="chat"
        locale="zh-CN"
        runtimeSetup={{
          loading: false,
          error: undefined,
          hasClaudeRuntimeReady: true,
          nodes: createSleiFixtures().nodes,
        }}
        data={createSleiFixtures()}
      />,
    );

    expect(html).toContain('data-active-view="chat"');
    expect(html).toContain("slei-app-shell");
    expect(html).toContain('aria-label="工作区"');
    expect(html).toContain("slei-workspace-sidebar");
    expect(html).toContain('data-slot="button"');
    expect(html).toContain('aria-current="page"');
    expect(html).toContain(">搜索</");
    expect(html).toContain(">任务</");
    expect(html).not.toContain("data-nav-icon");
    expect(html).not.toContain("Slei 协作中枢");
    expect(html).toContain('data-slot="workspace-sidebar-header"');
    expect(html).toContain('data-slot="workspace-sidebar-primary-nav"');
    expect(html).not.toContain(">Slei</h2>");
    expect(html).toContain("# all");
    expect(html).toContain("输入消息到 #all");
    expect(html).toContain("转为任务");
    expect(html).not.toContain('data-slot="agent-activity"');
    expect(html).not.toContain("Slei 智能体</strong>");
  });

  it("marks shell chrome and page title bars as draggable", () => {
    const html = renderToStaticMarkup(
      <SleiAppFrame
        activeView="chat"
        locale="zh-CN"
        runtimeSetup={{
          loading: false,
          error: undefined,
          hasClaudeRuntimeReady: true,
          nodes: createSleiFixtures().nodes,
        }}
        data={createSleiFixtures()}
        initialChatDraft="可以发送"
      />,
    );

    const navIndex = html.indexOf('aria-label="工作区"');

    expect(navIndex).toBeGreaterThanOrEqual(0);
    expect(html).toContain('class="slei-workspace-sidebar');
    expect(html).toContain('data-tauri-drag-region="deep"');
    expect(html).toContain('data-slot="workspace-titlebar"');
    expect(html).not.toContain('aria-label="关闭窗口"');
    expect(html).not.toContain('aria-label="最小化窗口"');
    expect(html).not.toContain('aria-label="最大化窗口"');
    expect(html).not.toContain("<textarea data-tauri-drag-region");
  });

  it("marks every workspace page title bar as draggable", () => {
    const data = createSleiFixtures({ members: createDemoMembers() });
    const views = ["chat", "search", "tasks", "members", "computers", "settings"] as const;

    for (const activeView of views) {
      const html = renderToStaticMarkup(
        <SleiAppFrame
          activeView={activeView}
          locale="zh-CN"
          runtimeSetup={{
            loading: false,
            error: undefined,
            hasClaudeRuntimeReady: true,
            nodes: data.nodes,
          }}
          data={data}
        />,
      );

      expect(html).toContain('data-slot="workspace-titlebar"');
      expect(html).toContain('data-tauri-drag-region="deep"');
      expect(html).not.toContain("<input data-tauri-drag-region");
      expect(html).not.toContain("<textarea data-tauri-drag-region");
    }
  });

  it("uses native window controls instead of rendering custom sidebar controls", () => {
    const data = createSleiFixtures();
    const views = ["chat", "search", "tasks", "members", "computers", "settings"] as const;

    for (const activeView of views) {
      const html = renderToStaticMarkup(
        <SleiAppFrame
          activeView={activeView}
          locale="zh-CN"
          runtimeSetup={{
            loading: false,
            error: undefined,
            hasClaudeRuntimeReady: true,
            nodes: data.nodes,
          }}
          data={data}
        />,
      );

      expect(html).toContain(`data-active-view="${activeView}"`);
      expect(html).not.toContain('aria-label="关闭窗口"');
      expect(html).not.toContain('aria-label="最小化窗口"');
      expect(html).not.toContain('aria-label="最大化窗口"');
    }
  });

  it("does not duplicate native window controls in English", () => {
    const html = renderToStaticMarkup(
      <SleiAppFrame
        activeView="chat"
        locale="en-US"
        runtimeSetup={{
          loading: false,
          error: undefined,
          hasClaudeRuntimeReady: true,
          nodes: createSleiFixtures().nodes,
        }}
        data={createSleiFixtures()}
      />,
    );

    expect(html).not.toContain('aria-label="Close window"');
    expect(html).not.toContain('aria-label="Minimize window"');
    expect(html).not.toContain('aria-label="Maximize window"');
  });

  it("does not render the custom close confirmation for native window controls", () => {
    const html = renderToStaticMarkup(
      <SleiAppFrame
        activeView="chat"
        locale="zh-CN"
        runtimeSetup={{
          loading: false,
          error: undefined,
          hasClaudeRuntimeReady: true,
          nodes: createSleiFixtures().nodes,
        }}
        data={createSleiFixtures()}
      />,
    );

    expect(html).not.toContain("确定要关闭窗口吗？");
  });

  it("does not render attention badges inside shell modals", () => {
    const data = createSleiFixtures();
    const guideHtml = renderToStaticMarkup(
      <SleiAppFrame
        activeView="chat"
        locale="zh-CN"
        runtimeSetup={{
          loading: false,
          error: undefined,
          hasClaudeRuntimeReady: true,
          nodes: data.nodes,
        }}
        data={data}
        guideBootstrapping
      />,
    );

    expect(guideHtml).toContain('role="status"');
    expect(guideHtml).toContain("data-slot");
    expect(guideHtml).not.toContain("等待确认");
  });

  it("renders a durable composer send action", () => {
    const html = renderToStaticMarkup(
      <SleiAppFrame
        activeView="chat"
        locale="zh-CN"
        runtimeSetup={{
          loading: false,
          error: undefined,
          hasClaudeRuntimeReady: true,
          nodes: createSleiFixtures().nodes,
        }}
        data={createSleiFixtures()}
        initialChatDraft="可以发送"
      />,
    );

    const sendButton = sendButtonMarkup(html);
    expect(sendButton).toContain('data-testid="slei-send-button"');
    expect(sendButton).not.toContain(' disabled=""');
    expect(html).toMatch(/<button\b(?=[^>]*data-testid="slei-send-button")[\s\S]*?>[\s\S]*发送[\s\S]*?<\/button>/);
  });

  it("renders broadcast-delivered agent activity feedback in the shell", () => {
    const data = createSleiFixtures({ members: createDemoMembers() });
    const messages = createChannelAgentActivityMessages(
      {
        messageId: "msg_broadcast_1",
        action: "broadcast_delivered",
        assigneeAgentIds: ["a1"],
      },
      "all",
      data.members,
    );
    const html = renderToStaticMarkup(
      <SleiAppFrame
        activeView="chat"
        activeChannelId="all"
        locale="zh-CN"
        runtimeSetup={{
          loading: false,
          error: undefined,
          hasClaudeRuntimeReady: true,
          nodes: data.nodes,
        }}
        data={{ ...data, messages }}
      />,
    );

    expect(html).toContain('data-slot="agent-activity"');
    expect(html).toContain("Coda");
    expect(html).toContain("正在思考");
  });

  it("renders all primary destinations from the single shell", () => {
    const data = createSleiFixtures();
    const views = ["chat", "search", "tasks", "members", "computers", "settings"] as const;

    for (const activeView of views) {
      const html = renderToStaticMarkup(
        <SleiAppFrame
          activeView={activeView}
          locale="zh-CN"
          runtimeSetup={{
            loading: false,
            error: undefined,
            hasClaudeRuntimeReady: true,
            nodes: data.nodes,
          }}
          data={data}
        />,
      );

      expect(html).toContain(`data-active-view="${activeView}"`);
      expect(html).toContain('class="slei-workspace-sidebar');
      expect(html).toContain('aria-label="调整侧栏宽度"');
      expect(html).toContain("slei-app-shell");
    }
  });
});
