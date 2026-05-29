export type ProfileState = {
  nickname: string;
  handle: string;
  bio?: string;
};

export function renderProfileForm(
  profile: ProfileState,
  locale: "zh-CN" | "en-US",
): string {
  const labels = createDesktopMessages(locale).settings;
  return [
    labels.nickname,
    profile.nickname,
    labels.handle,
    `@${profile.handle}`,
    labels.bio,
    profile.bio ?? "",
  ].join(" ");
}
import { createDesktopMessages } from "../../i18n";
