import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { Empty, SleiAppFrame } from "../src/app/SleiApp";
import { createSleiFixtures } from "../src/app/fixtures";

const emptyRuntime = {
  loading: false,
  error: undefined,
  hasClaudeRuntimeReady: true,
  nodes: [],
};

describe("empty state component", () => {
  it("supports no-data and no-result variants with multiple sizes", () => {
    const nodata = renderToStaticMarkup(
      <Empty description="创建第一个智能体后会显示在这里。" size="lg" title="暂无智能体" variant="nodata" />,
    );
    const noresult = renderToStaticMarkup(
      <Empty description="换一个关键词试试。" size="sm" title="没有结果" variant="noresult" />,
    );

    expect(nodata).toContain("slei-empty--nodata");
    expect(nodata).toContain("slei-empty--lg");
    expect(nodata).toContain("slei-empty__pixel-face");
    expect(nodata).toContain("slei-empty__pixel--eye");
    expect(nodata).toContain("slei-empty__pixel--mouth");
    expect(noresult).toContain("slei-empty--noresult");
    expect(noresult).toContain("slei-empty--sm");
    expect(noresult).toContain("slei-empty__pixel-face");
    expect(noresult).toContain("slei-empty__pixel--eye");
    expect(noresult).toContain("slei-empty__pixel--mouth");
  });

  it("centers the empty component when detail pages have no selected object", () => {
    const data = createSleiFixtures({ members: [], nodes: [] });
    const membersHtml = renderToStaticMarkup(
      <SleiAppFrame activeView="members" data={data} locale="zh-CN" runtimeSetup={emptyRuntime} />,
    );
    const computersHtml = renderToStaticMarkup(
      <SleiAppFrame activeView="computers" data={data} locale="zh-CN" runtimeSetup={emptyRuntime} />,
    );
    const css = readFileSync(join(process.cwd(), "src/app/app.css"), "utf8");

    expect(membersHtml).toContain("slei-detail-empty-page");
    expect(membersHtml).toContain("slei-empty-detail");
    expect(membersHtml).toContain("暂无智能体");
    expect(computersHtml).toContain("slei-detail-empty-page");
    expect(computersHtml).toContain("slei-empty-detail");
    expect(computersHtml).toContain("暂无设备");
    expect(css).toContain(".slei-detail-empty-page");
    expect(css).toContain("place-items: center");
  });
});
