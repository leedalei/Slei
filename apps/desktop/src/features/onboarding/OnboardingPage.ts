import { renderConnectionStep } from "./ConnectionStep";
import { renderProfileStep } from "./ProfileStep";
import { renderRuntimeStep } from "./RuntimeStep";

export function renderOnboardingPage(input: {
  locale: "zh-CN" | "en-US";
  hasProfile: boolean;
  daemonConnected: boolean;
  runtimeReady: boolean;
}): string {
  const title = input.locale === "zh-CN" ? "欢迎使用 Slei" : "Welcome to Slei";
  return [
    title,
    input.hasProfile ? "" : renderProfileStep(input.locale),
    renderConnectionStep(input),
    renderRuntimeStep(input),
  ]
    .filter(Boolean)
    .join(" ");
}
