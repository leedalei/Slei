import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { runWindowAction, SleiAppFrame } from "../src/app/SleiApp";
import { createSleiFixtures } from "../src/app/fixtures";

describe("Slei React desktop shell", () => {
  it("defaults to the Chat home page with Neo-Brutalism desktop structure", () => {
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
    expect(html).toContain('<div class="slei-window-controls" data-tauri-drag-region="deep"');
    expect(html).toContain('<div class="slei-sidebar__header" data-tauri-drag-region="deep"');
    expect(html).toContain('<header class="slei-workspace-header" data-tauri-drag-region="deep"');
    expect(html).not.toContain('class="slei-rail__button" data-tauri-drag-region');
    expect(html).not.toContain('class="slei-window-control slei-window-control--close" data-tauri-drag-region');
    expect(html).not.toContain('class="slei-window-control slei-window-control--minimize" data-tauri-drag-region');
    expect(html).not.toContain('class="slei-window-control slei-window-control--maximize" data-tauri-drag-region');
    expect(html).not.toContain('class="slei-timeline" data-tauri-drag-region');
    expect(html).not.toContain('class="slei-composer" data-tauri-drag-region');
    expect(html).not.toContain('class="slei-textarea" data-tauri-drag-region');
  });

  it("renders sidebar window controls on every shared sidebar page", () => {
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
      expect(html).toContain('class="slei-window-controls" data-tauri-drag-region="deep"');
      expect(html).toContain('aria-label="关闭窗口"');
      expect(html).toContain('aria-label="最小化窗口"');
      expect(html).toContain('aria-label="最大化窗口"');
    }
  });

  it("localizes sidebar window control labels in English", () => {
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

    expect(html).toContain('aria-label="Close window"');
    expect(html).toContain('aria-label="Minimize window"');
    expect(html).toContain('aria-label="Maximize window"');
  });

  it("orders window controls as minimize maximize close and renders the close confirmation dialog", () => {
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
        initialWindowCloseConfirmOpen
      />,
    );

    expect(html.indexOf('aria-label="最小化窗口"')).toBeLessThan(html.indexOf('aria-label="最大化窗口"'));
    expect(html.indexOf('aria-label="最大化窗口"')).toBeLessThan(html.indexOf('aria-label="关闭窗口"'));
    expect(html).toContain('class="slei-dialog slei-window-close-confirm"');
    expect(html).toContain("确定要关闭窗口吗？");
  });

  it("runs the selected Tauri window action", () => {
    const calls: string[] = [];
    const currentWindow = {
      close: () => {
        calls.push("close");
        return Promise.resolve();
      },
      minimize: () => {
        calls.push("minimize");
        return Promise.resolve();
      },
      toggleMaximize: () => {
        calls.push("toggleMaximize");
        return Promise.resolve();
      },
    };

    runWindowAction({ action: "minimize", currentWindow });
    runWindowAction({ action: "toggleMaximize", currentWindow });
    runWindowAction({ action: "close", currentWindow });

    expect(calls).toEqual(["minimize", "toggleMaximize", "close"]);
  });

  it("uses the primary button color for the composer send action", () => {
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

    expect(html).toContain('class="slei-button slei-button--primary slei-send-button"');
    expect(html).not.toContain('class="slei-button slei-button--accent slei-send-button"');
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
