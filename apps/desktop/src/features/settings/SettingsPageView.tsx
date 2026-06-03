import type { AppearancePreferences, AppLocale, DesktopNodeView, NotificationPreferences } from "../../lib/daemon-bridge";
import type { DesktopMessages } from "../../i18n";
import { defaultTimeZone, desktopVersion, profileAvatarPresets, type SettingsPanel, type UserProfile } from "../../app/model";
import { CheckboxControl, MemberAvatar, SelectControl } from "../../components";
export function SettingsPage(input: {
  activePanel: SettingsPanel;
  appearance: AppearancePreferences;
  locale: AppLocale;
  messages: DesktopMessages;
  notifications: NotificationPreferences;
  nodes: DesktopNodeView[];
  onAppearanceChange?: (appearance: AppearancePreferences) => Promise<void> | void;
  onLocaleChange?: (locale: AppLocale) => Promise<void> | void;
  onNotificationsChange?: (notifications: NotificationPreferences) => Promise<void> | void;
  onProfileChange?: (profile: UserProfile) => void;
  onTimeZoneChange?: (timeZone: string) => Promise<void> | void;
  profile: UserProfile;
  timeZone: string;
}) {
  const { appearance, locale, notifications, profile } = input;
  const labels = input.messages.settings;

  function updateProfile(patch: Partial<UserProfile>) {
    input.onProfileChange?.({ ...profile, ...patch });
  }

  function updateNotification(field: keyof NotificationPreferences, value: boolean) {
    input.onNotificationsChange?.({
      ...notifications,
      [field]: value,
    });
  }

  function updateAppearance(patch: Partial<AppearancePreferences>) {
    input.onAppearanceChange?.({
      ...appearance,
      ...patch,
    });
  }

  return (
    <section className="slei-settings-page" data-settings-panel={input.activePanel}>
      <header className="slei-workspace-header">
        <div>
          <h1>{labels.panelTitle[input.activePanel]}</h1>
          <p>{labels.panelSubtitle[input.activePanel]}</p>
        </div>
      </header>
      <div className="slei-settings-stack">
        {input.activePanel === "account" ? (
        <section className="slei-settings-section">
          <h2>{labels.profile}</h2>
          <div className="slei-settings-fields">
            <label className="slei-field"><span>{labels.displayName}</span><input className="slei-input" onChange={(event) => updateProfile({ displayName: event.currentTarget.value })} value={profile.displayName} /></label>
            <label className="slei-field"><span>@</span><input className="slei-input" onChange={(event) => updateProfile({ handle: event.currentTarget.value })} value={profile.handle} /></label>
          </div>
          <section aria-label={labels.avatarPresets} className="slei-profile-avatar-presets">
            <div>
              <h3>{labels.avatar}</h3>
              <p>{labels.avatarHint}</p>
            </div>
            <div className="slei-avatar-preset-list">
              {profileAvatarPresets.map((preset) => (
                <button
                  aria-label={preset.name}
                  aria-pressed={profile.avatar === preset.id ? "true" : "false"}
                  className="slei-avatar-preset"
                  key={preset.id}
                  onClick={() => updateProfile({ avatar: preset.id })}
                  type="button"
                >
                  <MemberAvatar
                    identity={{
                      id: preset.id,
                      name: preset.name,
                      handle: `@${preset.id}`,
                      avatar: preset.name.slice(0, 2),
                      avatarSeed: preset.id,
                    }}
                  />
                  <span>{preset.name}</span>
                </button>
              ))}
            </div>
          </section>
        </section>
        ) : null}
        {input.activePanel === "language-region" ? (
        <section className="slei-settings-section">
          <h2>{labels.languageRegion}</h2>
          <div className="slei-settings-fields">
            <label className="slei-field slei-language-field">
              <span>{labels.language}</span>
              <SelectControl
                ariaLabel={labels.language}
                className="slei-input slei-language-select"
                onChange={(value) => input.onLocaleChange?.(value)}
                options={[
                  { label: labels.languageNames["zh-CN"], value: "zh-CN" },
                  { label: labels.languageNames["en-US"], value: "en-US" },
                ]}
                value={locale}
              />
            </label>
            <label className="slei-field slei-language-field">
              <span>{labels.timeZone}</span>
              <SelectControl
                ariaLabel={labels.timeZone}
                className="slei-input slei-timezone-select"
                onChange={(value) => input.onTimeZoneChange?.(value)}
                options={timeZoneOptions}
                value={input.timeZone}
              />
            </label>
          </div>
        </section>
        ) : null}
        {input.activePanel === "appearance" ? (
        <section className="slei-settings-section">
          <h2>{labels.appearance}</h2>
          <div className="slei-settings-fields">
            <label className="slei-field slei-language-field">
              <span>{labels.theme}</span>
              <SelectControl
                ariaLabel={labels.theme}
                className="slei-input slei-theme-select"
                onChange={(value) => updateAppearance({ theme: value })}
                options={[
                  { label: labels.themeSystem, value: "system" },
                  { label: labels.themeLight, value: "light" },
                  { label: labels.themeDark, value: "dark" },
                  { label: labels.themeHighContrast, value: "highContrast" },
                ]}
                value={appearance.theme}
              />
            </label>
            <div className="slei-field">
              <span>{labels.fontSize}</span>
              <div className="slei-segmented-control" role="group" aria-label={labels.fontSize}>
                {(["sm", "md", "lg"] as const).map((size) => (
                  <button
                    aria-pressed={appearance.fontSize === size ? "true" : "false"}
                    className="slei-segmented-control__button"
                    key={size}
                    onClick={() => updateAppearance({ fontSize: size })}
                    type="button"
                  >
                    {labels.fontSizes[size]}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </section>
        ) : null}
        {input.activePanel === "notifications" ? (
        <section className="slei-settings-section">
          <h2>{labels.notifications}</h2>
          <div className="slei-settings-toggle-list">
            <CheckboxControl
              checked={notifications.mentions}
              className="slei-notification-toggle"
              label={labels.mentionNotifications}
              onChange={(checked) => updateNotification("mentions", checked)}
            />
            <CheckboxControl
              checked={notifications.humanReplies}
              className="slei-notification-toggle"
              label={labels.humanReplyNotifications}
              onChange={(checked) => updateNotification("humanReplies", checked)}
            />
            <CheckboxControl
              checked={notifications.approvals}
              className="slei-notification-toggle"
              label={labels.approvalNotifications}
              onChange={(checked) => updateNotification("approvals", checked)}
            />
          </div>
        </section>
        ) : null}
        {input.activePanel === "about" ? (
        <section className="slei-settings-section">
          <h2>{labels.about}</h2>
          <div className="slei-about-list">
            <div><span>{labels.desktopVersion}</span><strong>{desktopVersion}</strong></div>
            <div><span>{labels.daemonVersion}</span><strong>{input.nodes[0]?.daemonVersion ?? "unknown"}</strong></div>
            <div><span>{labels.connectedComputers}</span><strong>{input.nodes.length}</strong></div>
          </div>
        </section>
        ) : null}
      </div>
    </section>
  );
}

const timeZoneOptions = [
  { value: "Asia/Shanghai", label: "Asia/Shanghai" },
  { value: "America/Los_Angeles", label: "America/Los_Angeles" },
  { value: "America/New_York", label: "America/New_York" },
  { value: "Europe/London", label: "Europe/London" },
  { value: "UTC", label: "UTC" },
];
