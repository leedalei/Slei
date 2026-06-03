import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  agentsForComputerNode,
  createDraftComputerNode,
  deleteComputerNode,
  SleiAppFrame,
  renameComputerNode,
} from "../src/app/SleiApp";
import { createDemoMembers, createSleiFixtures } from "../src/app/fixtures";
import type { DesktopNodeView } from "../src/lib/daemon-bridge";

const nodes: DesktopNodeView[] = [
  {
    id: "local-node",
    name: "MacBookPro M4 MAX",
    status: "connected",
    daemonVersion: "0.54.1",
    created: "May 26, 2026",
    device: {
      platform: "darwin",
      arch: "arm64",
      hostname: "MateBook-Pro-Max-3.local",
    },
    runtimes: [
      { kind: "ClaudeCode", readiness: "ready", version: "v1.0.54" },
      { kind: "CodexCLI", readiness: "ready", version: "v0.8.0" },
      { kind: "CursorCLI", readiness: "unavailable" },
    ],
  },
  {
    id: "office-win",
    name: "公司台式Win",
    status: "offline",
    daemonVersion: "0.54.1",
    created: "May 27, 2026",
    device: {
      platform: "windows",
      arch: "x64",
      hostname: "office-win.local",
    },
    runtimes: [{ kind: "ClaudeCode", readiness: "unknown" }],
  },
];

const data = createSleiFixtures({ nodes, members: createDemoMembers() });
const readyRuntime = {
  loading: false,
  error: undefined,
  hasClaudeRuntimeReady: true,
  nodes,
};

describe("computers management page", () => {
  it("renders a screenshot-style device list and selected device detail", () => {
    const html = renderToStaticMarkup(
      <SleiAppFrame activeView="computers" data={data} locale="zh-CN" runtimeSetup={readyRuntime} />,
    );

    expect(html).toContain("slei-computers-page");
    expect(html).toContain("slei-computers-list");
    expect(html).toContain("slei-computer-detail");
    expect(html).toContain('<aside class="slei-context-sidebar">');
    expect(html).not.toContain("slei-sidebar__header");
    expect(html).toContain('<main class="slei-workspace"><section class="slei-computers-page"><article class="slei-computer-detail"');
    expect(html).not.toContain('<section class="slei-computers-page"><aside class="slei-computers-list"');
    expect(html).toContain("设备 2");
    expect(html).toContain("MacBookPro M4 MAX");
    expect(html).toContain("公司台式Win");
    expect(html).toContain("NAME");
    expect(html).toContain("信息");
    expect(html).toContain("OS");
    expect(html).toContain("darwin arm64");
    expect(html).toContain("Daemon Version");
    expect(html).toContain("检测到的运行时");
    expect(html).toContain("创建时间");
    expect(html).toContain("此设备上的智能体");
    expect(html).toContain("slei-avatar__image");
    expect(html).toContain("Coda");
    expect(html).toContain("Cindy");
    expect(html).toContain("Alice");
    expect(html).toContain("运行时智能体");
  });

  it("exposes add, name edit, and delete controls while keeping OS read-only", () => {
    const html = renderToStaticMarkup(
      <SleiAppFrame activeView="computers" data={data} locale="zh-CN" runtimeSetup={readyRuntime} />,
    );

    expect(html).toContain('aria-label="新增设备"');
    expect(html).toContain('aria-label="编辑设备名称"');
    expect(html).toContain('aria-label="删除设备 公司台式Win"');
    expect(html).not.toContain('aria-label="编辑系统信息"');
    expect(html).not.toContain("更新 OS");
  });

  it("keeps device detail read-only for associated agents and creation controls", () => {
    const html = renderToStaticMarkup(
      <SleiAppFrame activeView="computers" data={data} locale="zh-CN" runtimeSetup={readyRuntime} />,
    );
    const detailHtml = html.match(/<article class="slei-computer-detail"[\s\S]*<\/article>/)?.[0] ?? "";

    expect(detailHtml).toContain("此设备上的智能体");
    expect(detailHtml).not.toContain('aria-label="新增设备"');
    expect(detailHtml).not.toContain(">Select<");
    expect(detailHtml).not.toContain(">Create<");
  });

  it("keeps computer helper updates immutable and derives hosted agents from real members", () => {
    const draft = createDraftComputerNode("Design Mac", "darwin arm64");
    expect(draft.id).toMatch(/^computer-/);
    expect(draft.name).toBe("Design Mac");
    expect(draft.device.platform).toBe("darwin");
    expect(draft.device.arch).toBe("arm64");

    const updated = renameComputerNode(nodes, "office-win", "Office Windows");
    expect(updated.find((node) => node.id === "office-win")?.name).toBe("Office Windows");
    expect(updated.find((node) => node.id === "office-win")?.device.platform).toBe("windows");
    expect(nodes.find((node) => node.id === "office-win")?.name).toBe("公司台式Win");

    expect(deleteComputerNode(updated, "office-win")).toHaveLength(1);
    expect(deleteComputerNode(updated, "local-node")).toHaveLength(2);
    expect(agentsForComputerNode(nodes[0], data.members).map((member) => member.name)).toEqual([
      "Coda",
      "Cindy",
      "Alice",
      "运行时智能体",
    ]);
  });
});
