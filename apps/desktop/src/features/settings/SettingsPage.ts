import { createDesktopMessages } from "../../i18n";
import { renderLanguageSettings } from "./LanguageSettings";
import { renderNotificationSettings, type NotificationState } from "./NotificationSettings";
import { renderProfileForm, type ProfileState } from "./ProfileForm";

export function renderSettingsPage(input: {
  locale: "zh-CN" | "en-US";
  profile: ProfileState;
  notifications: NotificationState;
}): string {
  const labels = createDesktopMessages(input.locale).settings;
  return [
    labels.title,
    renderProfileForm(input.profile, input.locale),
    renderLanguageSettings(input.locale),
    renderNotificationSettings(input.notifications, input.locale),
  ].join(" ");
}
