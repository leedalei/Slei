import { existsSync, readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";

import { createSleiFixtures } from "../src/app/fixtures";
import { routeItems, routePathForView, routeViewFromPath } from "../src/app/router";
import { SleiAppFrameRoutes } from "../src/app/SleiApp";

const readyRuntime = {
  loading: false,
  error: undefined,
  hasClaudeRuntimeReady: true,
  nodes: createSleiFixtures().nodes,
};

describe("desktop routes", () => {
  it("maps top-level views to browser paths", () => {
    expect(routeItems.map((item) => item.path)).toEqual([
      "/chat",
      "/search",
      "/tasks",
      "/members",
      "/computers",
      "/settings",
    ]);
    expect(routePathForView("chat")).toBe("/chat");
    expect(routePathForView("search")).toBe("/search");
    expect(routePathForView("tasks")).toBe("/tasks");
    expect(routeViewFromPath("/members")).toBe("members");
    expect(routeViewFromPath("/nope")).toBe("chat");
  });

  it("renders the active routed page for browser paths and falls back to chat", () => {
    const data = createSleiFixtures();

    for (const [path, view] of [
      ["/chat", "chat"],
      ["/tasks", "tasks"],
      ["/members", "members"],
      ["/missing", "chat"],
    ] as const) {
      const html = renderToStaticMarkup(
        <MemoryRouter initialEntries={[path]}>
          <SleiAppFrameRoutes data={data} locale="zh-CN" runtimeSetup={readyRuntime} />
        </MemoryRouter>,
      );

      expect(html).toContain(`data-active-view="${view}"`);
    }
  });

  it("keeps top-level route components outside the app shell file", () => {
    const routeFiles = [
      "src/app/routes/ChatRoute.tsx",
      "src/app/routes/SearchRoute.tsx",
      "src/app/routes/TasksRoute.tsx",
      "src/app/routes/MembersRoute.tsx",
      "src/app/routes/ComputersRoute.tsx",
      "src/app/routes/SettingsRoute.tsx",
    ];
    const frameTsx = readFileSync("src/app/SleiAppFrame.tsx", "utf8");

    expect(routeFiles.every((file) => existsSync(file))).toBe(true);
    expect(frameTsx).not.toContain("return <ChatPage");
    expect(frameTsx).not.toContain("return <SearchPage");
    expect(frameTsx).not.toContain("return <TasksPage");
    expect(frameTsx).not.toContain("return <MembersPage");
    expect(frameTsx).not.toContain("return <ComputersPage");
    expect(frameTsx).not.toContain("return <SettingsPage");
  });
});
