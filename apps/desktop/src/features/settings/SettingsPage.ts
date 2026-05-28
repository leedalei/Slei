import { renderLanguageSettings } from "./LanguageSettings";
import { renderNotificationSettings, type NotificationState } from "./NotificationSettings";
import { renderProfileForm, type ProfileState } from "./ProfileForm";

export function renderSettingsPage(input: {
  locale: "zh-CN" | "en-US";
  profile: ProfileState;
  notifications: NotificationState;
}): string {
  const labels = dictionary[input.locale];
  return [
    labels.title,
    renderProfileForm(input.profile, input.locale),
    renderLanguageSettings(input.locale),
    renderNotificationSettings(input.notifications, input.locale),
  ].join(" ");
}

const dictionary = {
  "zh-CN": {
    title: "设置",
  },
  "en-US": {
    title: "Settings",
  },
};
