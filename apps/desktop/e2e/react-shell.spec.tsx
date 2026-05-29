import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { SleiAppFrame } from "../src/app/SleiApp";
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
