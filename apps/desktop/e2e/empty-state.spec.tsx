import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { Empty, SleiAppFrame } from "../src/app/SleiApp";
import { createSleiFixtures } from "../src/test/fixtures";

const emptyRuntime = {
  loading: false,
  error: undefined,
  hasClaudeRuntimeReady: true,
  nodes: [],
};

describe("empty state component", () => {
  it("renders semantic no-data and no-result empty states", () => {
    const nodata = renderToStaticMarkup(
      <Empty description="创建第一个智能体后会显示在这里" size="lg" title="暂无智能体" variant="nodata" />,
    );
    const noresult = renderToStaticMarkup(
      <Empty description="换一个关键词试试" size="sm" title="没有结果" variant="noresult" />,
    );

    expect(nodata).toContain('role="status"');
    expect(nodata).toContain('data-empty-variant="nodata"');
    expect(nodata).toContain('data-empty-size="lg"');
    expect(nodata).toContain('data-empty-icon="true"');
    expect(nodata).toContain('data-empty-illustration="nodata"');
    expect(nodata).toContain('data-empty-asset="data"');
    expect(nodata).toContain("empty-data.png");
    expect(nodata).not.toContain('data-slot="card"');
    expect(nodata).not.toContain('data-slot="card-content"');
    expect(nodata).not.toContain("border");
    expect(nodata).not.toContain("bg-");
    expect(nodata).not.toContain("slei-empty__pixel-face");
    expect(nodata).toContain("暂无智能体");
    expect(nodata).toContain("创建第一个智能体后会显示在这里");
    expect(noresult).toContain('role="status"');
    expect(noresult).toContain('data-empty-variant="noresult"');
    expect(noresult).toContain('data-empty-size="sm"');
    expect(noresult).toContain('data-empty-illustration="noresult"');
    expect(noresult).toContain('data-empty-asset="search"');
    expect(noresult).toContain("empty-search.png");
    expect(noresult).not.toContain('data-slot="card"');
    expect(noresult).not.toContain('data-slot="card-content"');
    expect(noresult).not.toContain("border");
    expect(noresult).not.toContain("bg-");
    expect(noresult).not.toContain("bg-amber-500/10");
    expect(noresult).toContain("没有结果");
    expect(noresult).toContain("换一个关键词试试");
  });

  it("supports title-only empty states without a repeated description", () => {
    const titleOnly = renderToStaticMarkup(
      <Empty size="lg" title="暂无数据" variant="nodata" />,
    );

    expect(titleOnly).toContain("暂无数据");
    expect(titleOnly).not.toContain("<p");
    expect(titleOnly).not.toContain("这里还没有数据。");
  });

  it("renders empty detail fallbacks for unselected members and computers", () => {
    const data = createSleiFixtures({ members: [], nodes: [] });
    const membersHtml = renderToStaticMarkup(
      <SleiAppFrame activeView="members" data={data} locale="zh-CN" runtimeSetup={emptyRuntime} />,
    );
    const computersHtml = renderToStaticMarkup(
      <SleiAppFrame activeView="computers" data={data} locale="zh-CN" runtimeSetup={emptyRuntime} />,
    );

    expect(membersHtml).toContain('role="status"');
    expect(membersHtml).toContain("暂无智能体");
    expect(computersHtml).toContain('role="status"');
    expect(computersHtml).toContain("暂无设备");
  });

  it("does not repeat generic no-data copy in the main chat empty state", () => {
    const data = createSleiFixtures({ channels: [] });
    const html = renderToStaticMarkup(
      <SleiAppFrame activeView="chat" data={data} locale="zh-CN" runtimeSetup={emptyRuntime} />,
    );

    expect(html).toContain("暂无数据");
    expect(html).not.toContain("这里还没有数据。");
  });
});
