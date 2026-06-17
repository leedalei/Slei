import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { applyPreferenceMutation, SleiAppFrame } from "../src/app/SleiApp";
import { createDesktopMessages } from "../src/i18n";
import { createSleiFixtures } from "../src/test/fixtures";

const data = createSleiFixtures({
  channels: [{ id: "all", name: "general", description: "默认团队频道", unread: 0 }],
  messages: [],
  members: [],
  tasks: [],
});

const readyRuntime = {
  loading: false,
  error: undefined,
  hasClaudeRuntimeReady: true,
  nodes: data.nodes,
};

describe("desktop i18n", () => {
  it("rolls back failed language saves and exposes error copy in the restored locale", async () => {
    let activeLocale: "zh-CN" | "en-US" = "zh-CN";
    let preferenceError = "";

    await expect(
      applyPreferenceMutation({
        current: "zh-CN" as const,
        optimistic: "en-US" as const,
        applyOptimistic: (value) => {
          activeLocale = value;
        },
        persist: async () => {
          throw new Error("daemon offline");
        },
        applyConfirmed: (value) => {
          activeLocale = value;
        },
        onError: (error) => {
          const detail = error instanceof Error ? error.message : String(error);
          preferenceError = `${createDesktopMessages(activeLocale).settings.saveFailed}：${detail}`;
        },
      }),
    ).rejects.toThrow("daemon offline");

    const html = renderToStaticMarkup(
      <SleiAppFrame
        activeView="settings"
        data={data}
        initialSettingsPanel="language-region"
        locale={activeLocale}
        preferenceError={preferenceError}
        runtimeSetup={readyRuntime}
      />,
    );
    expect(activeLocale).toBe("zh-CN");
    expect(html).toContain('aria-label="主导航"');
    expect(html).toContain("保存失败：daemon offline");
    expect(html).not.toContain("Save failed");
  });

  it("switches the whole shell and active page copy when locale changes", () => {
    const english = renderToStaticMarkup(
      <SleiAppFrame activeView="chat" data={data} locale="en-US" runtimeSetup={readyRuntime} />,
    );
    const chinese = renderToStaticMarkup(
      <SleiAppFrame activeView="chat" data={data} locale="zh-CN" runtimeSetup={readyRuntime} />,
    );

    expect(english).toContain('aria-label="Main navigation"');
    expect(english).toContain("CHANNELS");
    expect(english).toContain("DIRECT MESSAGES");
    expect(english).toContain("Files");
    expect(english).toContain("As Task");
    expect(english).toContain("Send");
    expect(english).not.toContain("主导航");
    expect(english).not.toContain("转为任务");
    expect(english).not.toContain("发送");

    expect(chinese).toContain('aria-label="主导航"');
    expect(chinese).not.toContain("Slei</strong><span>工作区</span>");
    expect(chinese).toContain("转为任务");
    expect(chinese).toContain("发送");
  });

  it("uses the agreed Chinese product terms in zh-CN", () => {
    const chat = renderToStaticMarkup(
      <SleiAppFrame activeView="chat" data={data} locale="zh-CN" runtimeSetup={readyRuntime} />,
    );
    const members = renderToStaticMarkup(
      <SleiAppFrame activeView="members" data={createSleiFixtures({ messages: [], tasks: [] })} locale="zh-CN" runtimeSetup={readyRuntime} />,
    );
    const computers = renderToStaticMarkup(
      <SleiAppFrame activeView="computers" data={data} locale="zh-CN" runtimeSetup={readyRuntime} />,
    );
    const settings = renderToStaticMarkup(
      <SleiAppFrame activeView="settings" data={data} locale="zh-CN" runtimeSetup={readyRuntime} />,
    );

    const html = [chat, members, computers, settings].join("\n");
    expect(html).toContain("频道");
    expect(html).toContain("智能体");
    expect(html).toContain("私聊");
    expect(html).toContain("任务");
    expect(html).toContain("附件");
    expect(html).toContain("成员");
    expect(html).toContain("设备");
    expect(html).toContain("设置");
    expect(html).toContain("个人");
    expect(html).toContain("服务端");
    expect(html).toContain("关于");
    expect(html).not.toContain("CHANNELS");
    expect(html).not.toContain("DIRECT MESSAGES");
    expect(html).not.toContain("AGENTS");
    expect(html).not.toContain("COMPUTERS");
    expect(html).not.toContain("PERSON");
    expect(html).not.toContain("SERVER");
    expect(html).not.toContain("ABOUT");
  });
});
