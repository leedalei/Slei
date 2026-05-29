import type { DaemonBridge } from "../lib/daemon-bridge";
import { createDesktopMessages } from "../i18n";

export async function renderAppShell(input: {
  bridge: DaemonBridge;
  locale?: "zh-CN" | "en-US";
}): Promise<string> {
  const locale = input.locale ?? "zh-CN";
  const status = await input.bridge.daemonStatus();
  const messages = createDesktopMessages(locale);

  return [
    messages.shell.nav.chat,
    messages.shell.nav.tasks,
    messages.shell.nav.members,
    messages.shell.nav.computers,
    messages.shell.nav.settings,
    status.connected ? messages.computers.connected : messages.computers.offline,
  ].join(" ");
}
