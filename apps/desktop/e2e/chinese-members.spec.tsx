import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { SleiAppFrame } from "../src/app/SleiApp";
import { createDemoMembers, createSleiFixtures } from "../src/app/fixtures";

const data = createSleiFixtures({ members: createDemoMembers() });
const readyRuntime = {
  loading: false,
  error: undefined,
  hasClaudeRuntimeReady: true,
  nodes: data.nodes,
};

describe("Chinese-first desktop MVP", () => {
  it("defaults to only the #all channel", () => {
    const html = renderToStaticMarkup(
      <SleiAppFrame activeView="chat" data={data} locale="zh-CN" runtimeSetup={readyRuntime} />,
    );

    expect(data.channels).toHaveLength(1);
    expect(html).toContain("# all");
    expect(html).toContain("所有成员的默认频道");
    expect(html).not.toContain("# runtime");
    expect(html).not.toContain("# mvp");
  });

  it("renders the React shell in Chinese by default", () => {
    const html = renderToStaticMarkup(
      <SleiAppFrame activeView="chat" data={data} locale="zh-CN" runtimeSetup={readyRuntime} />,
    );

    expect(html).toContain('aria-label="聊天"');
    expect(html).toContain('aria-label="设置"');
    expect(html).toContain("频道");
    expect(html).toContain("输入消息到 #all");
    expect(html).toContain("转为任务");
    expect(html).toContain("发送");
    expect(html).not.toContain("Channels");
    expect(html).not.toContain("Message #all");
    expect(html).not.toContain("As Task");
    expect(html).not.toContain("Send");
  });

  it("renders computers and settings labels in Chinese by default", () => {
    const computersHtml = renderToStaticMarkup(
      <SleiAppFrame activeView="computers" data={data} locale="zh-CN" runtimeSetup={readyRuntime} />,
    );
    const settingsHtml = renderToStaticMarkup(
      <SleiAppFrame activeView="settings" data={data} locale="zh-CN" runtimeSetup={readyRuntime} />,
    );

    expect(computersHtml).toContain("OS / 系统");
    expect(computersHtml).toContain("darwin arm64");
    expect(computersHtml).not.toContain("Platform / 平台");
    expect(computersHtml).not.toContain("Arch / 架构");
    expect(computersHtml).toContain("主机名");
    expect(settingsHtml).toContain("个人资料");
    expect(settingsHtml).toContain("个人");
    expect(settingsHtml).toContain("语言与地区");
    expect(settingsHtml).toContain("通知");
    expect(settingsHtml).not.toContain("Profile");
    expect(settingsHtml).not.toContain("诊断");
  });

  it("renders members as left list and right detail configuration", () => {
    const html = renderToStaticMarkup(
      <SleiAppFrame activeView="members" data={data} locale="zh-CN" runtimeSetup={readyRuntime} />,
    );

    expect(html).toContain("slei-members-page");
    expect(html).toContain("slei-members-navigator");
    expect(html).toContain("slei-member-detail");
    expect(html).toContain("智能体");
    expect(html).toContain("Coda");
    expect(html).toContain("@Coda");
    expect(html).not.toContain("图谱");
    expect(html).not.toContain("HUMANS");
    expect(html).not.toContain("Lei");
    expect(html).toContain("成员详情");
    expect(html).toContain("资料");
    expect(html).toContain("工作区");
    expect(html).not.toContain("Agent 私信");
    expect(html).not.toContain("提醒");
    expect(html).not.toContain("应用");
    expect(html).toContain("显示名称");
    expect(html).toContain("描述");
    expect(html).toContain("信息");
    expect(html).toContain("运行时配置");
    expect(html).toContain("MEMORY.md");
    expect(html).toContain("docs");
    expect(html).toContain("默认技能");
  });
});
