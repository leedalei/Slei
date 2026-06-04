import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { SleiAppFrame } from "../src/app/SleiApp";
import { createSleiFixtures } from "../src/app/fixtures";

function sendButtonMarkup(html: string) {
  return html.match(/<button\b(?=[^>]*data-testid="slei-send-button")[^>]*>/)?.[0] ?? "";
}

describe("Slei React desktop shell", () => {
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
    expect(html).toContain('grid-template-columns:5.5rem var(--slei-sidebar-width, 15rem) 0.5rem minmax(0, 1fr)');
    expect(html).toContain('aria-label="主导航"');
    expect(html).toContain("pt-10");
    expect(html).toContain('data-slot="button"');
    expect(html).toContain(">聊天<");
    expect(html).toContain(">任务<");
    expect(html).toContain(">成员<");
    expect(html).toContain(">运行设备<");
    expect(html).toContain(">设置<");
    expect(html).not.toContain("Slei 协作中枢");
    expect(html).toContain(">聊天</h2>");
    expect(html).toContain("# all");
    expect(html).toContain("所有成员的默认频道");
    expect(html).toContain("输入消息到 #all");
    expect(html).toContain("转为任务");
  });

  it("marks only shell chrome regions as draggable", () => {
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

    const navIndex = html.indexOf('aria-label="主导航"');

    expect(navIndex).toBeGreaterThanOrEqual(0);
    expect(html.slice(Math.max(0, navIndex - 120), navIndex + 120)).toContain('data-tauri-drag-region="deep"');
    expect(html).not.toContain('aria-label="关闭窗口"');
    expect(html).not.toContain('aria-label="最小化窗口"');
    expect(html).not.toContain('aria-label="最大化窗口"');
    expect(html).not.toContain("<header data-tauri-drag-region");
    expect(html).not.toContain("<textarea data-tauri-drag-region");
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
    expect(html).toContain(">发送</button>");
  });

  it("renders all primary destinations from the single shell", () => {
    const data = createSleiFixtures();
    const views = ["chat", "tasks", "members", "computers", "settings"] as const;
    const sidebarTitles = {
      chat: "聊天",
      tasks: "任务",
      members: "成员",
      computers: "运行设备",
      settings: "设置",
    };

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
      expect(html).toContain(`>${sidebarTitles[activeView]}</h2>`);
    }
  });
});
