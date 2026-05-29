import type { AppLocale } from "../lib/daemon-bridge";
import { enUSMessages } from "./messages/en-US";
import { zhCNMessages } from "./messages/zh-CN";
import type { DesktopMessages } from "./types";

export type { DesktopMessages };

export function createDesktopMessages(locale: AppLocale): DesktopMessages {
  return locale === "en-US" ? enUSMessages : zhCNMessages;
}
