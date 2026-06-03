import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { SleiAppFrame } from "../src/app/SleiApp";
import { createSleiFixtures } from "../src/app/fixtures";

describe("Slei React desktop shell", () => {
  it("defaults to the Chat home page with Animal Island desktop structure", () => {
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

    expect(html).toContain("slei-shell");
    expect(html).toContain("--slei-sidebar-width:240px");
    expect(html).toContain("--slei-font-size:15px");
    expect(html).toContain("slei-rail");
    expect(html).toContain('<span aria-hidden="true" class="slei-brand__mark">L</span>');
    expect(html).not.toContain("slei-brand__logo");
    expect(html).toContain('<span class="slei-rail__label">聊天</span>');
    expect(html).toContain('<span class="slei-rail__label">任务</span>');
    expect(html).toContain('<span class="slei-rail__label">成员</span>');
    expect(html).toContain("lucide-square-check-big");
    expect(html).toContain("lucide-circle-user-round");
    expect(html).not.toContain("lucide-list-todo");
    expect(html).toContain("slei-context-sidebar");
    expect(html).toContain("slei-workspace");
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
      />,
    );

    expect(html).toContain('<nav class="slei-rail" data-tauri-drag-region="deep"');
    expect(html).not.toContain("slei-window-controls");
    expect(html).not.toContain('<header class="slei-workspace-header" data-tauri-drag-region');
    expect(html).not.toContain('class="slei-rail__button" data-tauri-drag-region');
    expect(html).not.toContain('class="slei-window-control slei-window-control--close" data-tauri-drag-region');
    expect(html).not.toContain('class="slei-window-control slei-window-control--minimize" data-tauri-drag-region');
    expect(html).not.toContain('class="slei-window-control slei-window-control--maximize" data-tauri-drag-region');
    expect(html).not.toContain("slei-sidebar__header");
    expect(html).not.toContain('class="slei-timeline" data-tauri-drag-region');
    expect(html).not.toContain('class="slei-composer" data-tauri-drag-region');
    expect(html).not.toContain('class="slei-textarea" data-tauri-drag-region');
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
      expect(html).not.toContain("slei-window-controls");
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

    expect(html).not.toContain('class="slei-dialog slei-window-close-confirm"');
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

    expect(guideHtml).not.toContain("slei-badge--attention");
  });

  it("uses the accent button color for the composer send action", () => {
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

    expect(html).toContain('class="slei-button slei-button--accent slei-send-button"');
    expect(html).not.toContain('class="slei-button slei-button--primary slei-send-button"');
  });

  it("renders all primary destinations from the single shell", () => {
    const data = createSleiFixtures();
    const views = ["chat", "tasks", "members", "computers", "settings"] as const;

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
    }
  });
});
