import { describe, expect, it } from "vitest";

import { renderOnboardingPage } from "../src/features/onboarding/OnboardingPage";

describe("first-run onboarding", () => {
  it("redirects missing profile to Chinese onboarding by default", () => {
    const html = renderOnboardingPage({
      locale: "zh-CN",
      hasProfile: false,
      daemonConnected: true,
      runtimeReady: true,
    });

    expect(html).toContain("欢迎使用 Slei");
    expect(html).toContain("昵称");
    expect(html).toContain("创建你的身份");
    expect(html).toContain('data-slot="card"');
    expect(html).not.toContain("data-slei-panel");
    expect(html).not.toContain("data-variant=");
  });

  it("can switch to English before identity is saved", () => {
    const html = renderOnboardingPage({
      locale: "en-US",
      hasProfile: false,
      daemonConnected: true,
      runtimeReady: true,
    });

    expect(html).toContain("Welcome to Slei");
    expect(html).toContain("Nickname");
    expect(html).not.toContain("昵称");
  });

  it("blocks completion while daemon is offline or runtime is unavailable", () => {
    const offline = renderOnboardingPage({
      locale: "zh-CN",
      hasProfile: false,
      daemonConnected: false,
      runtimeReady: false,
    });
    expect(offline).toContain("Daemon 未启动");
    expect(offline).toContain("无法完成");
    expect(offline).not.toContain("data-slei-panel");
    expect(offline).not.toContain("data-variant=");

    const runtimeUnavailable = renderOnboardingPage({
      locale: "zh-CN",
      hasProfile: true,
      daemonConnected: true,
      runtimeReady: false,
    });
    expect(runtimeUnavailable).toContain("运行时不可用");
    expect(runtimeUnavailable).toContain("不会创建引导员");
    expect(runtimeUnavailable).not.toContain("data-slei-panel");
    expect(runtimeUnavailable).not.toContain("data-variant=");
  });
});
