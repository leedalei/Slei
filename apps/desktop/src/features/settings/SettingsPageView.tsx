import { useRef } from "react";
import type { AppearancePreferences, AppLocale, DesktopNodeView, NotificationPreferences } from "../../lib/daemon-bridge";
import type { DesktopMessages } from "../../i18n";
import { defaultTimeZone, desktopVersion, localHumanPresentation, normalizeAppearanceTheme, randomProfileAvatarPresetId, type SettingsPanel, type UserProfile } from "../../app/model";
import { EditableDetailField, MemberAvatar, PageHeader, PreferenceRow, SleiIcon, sleiIcons } from "../../components";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Field, FieldLabel } from "@/components/ui/field";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import * as SelectPrimitive from "@radix-ui/react-select";

type SettingsPageInput = {
  activePanel: SettingsPanel;
  appearance: AppearancePreferences;
  locale: AppLocale;
  messages: DesktopMessages;
  notifications: NotificationPreferences;
  nodes: DesktopNodeView[];
  onAppearanceChange?: (appearance: AppearancePreferences) => Promise<void> | void;
  onLocaleChange?: (locale: AppLocale) => Promise<void> | void;
  onNotificationsChange?: (notifications: NotificationPreferences) => Promise<void> | void;
  onProfileAvatarUpload?: (file: File) => Promise<void> | void;
  onProfileChange?: (patch: Partial<Pick<UserProfile, "displayName" | "avatar">>) => Promise<void> | void;
  onTimeZoneChange?: (timeZone: string) => Promise<void> | void;
  pendingPreference?: "locale" | "timeZone" | "appearance" | "notifications";
  preferenceError?: string;
  pendingProfileField?: "displayName" | "avatar";
  profile: UserProfile | null;
  profileErrors?: Partial<Record<"displayName" | "avatar", string>>;
  timeZone: string;
};

type SelectOption<TValue extends string> = {
  label: string;
  value: TValue;
};

const settingsControlStackClass = "grid gap-3";
const settingsSectionCardClass = "border-[var(--settings-section-border)] bg-[var(--settings-section-bg)] text-card-foreground shadow-none";

export function SettingsPage(input: SettingsPageInput) {
  const labels = input.messages.settings;
  const activeTheme = normalizeAppearanceTheme(input.appearance.theme);
  const profile = localHumanPresentation(input.profile, input.messages);
  const preferencePending = Boolean(input.pendingPreference);
  const profilePending = Boolean(input.pendingProfileField);
  const avatarUploadId = "settings-profile-avatar-upload";
  const avatarUploadDisabled = profilePending || !input.onProfileAvatarUpload;
  const avatarUploadInputRef = useRef<HTMLInputElement | null>(null);

  function updateNotification(field: keyof NotificationPreferences, value: boolean) {
    runSettingsFireAndForgetAction(() => input.onNotificationsChange?.({
      ...input.notifications,
      [field]: value,
    }));
  }

  function updateAppearance(patch: Partial<AppearancePreferences>) {
    runSettingsFireAndForgetAction(() => input.onAppearanceChange?.({
      ...input.appearance,
      ...patch,
    }));
  }

  return (
    <section className="h-full min-h-0 overflow-hidden bg-transparent" data-settings-panel={input.activePanel}>
      <ScrollArea className="h-full min-h-0">
        <div className="mx-auto grid w-full max-w-4xl gap-4 p-4 sm:p-6">
          <PageHeader
            className="select-none"
            data-slot="workspace-titlebar"
            data-testid="slei-settings-panel-header"
            icon={settingsPanelIcon(input.activePanel)}
            subtitle={<span>{labels.panelSubtitle[input.activePanel]}</span>}
            title={<span>{labels.panelTitle[input.activePanel]}</span>}
          />

          {input.activePanel === "account" ? (
            <Card className={settingsSectionCardClass}>
              <CardContent className={cn("p-4", settingsControlStackClass)} data-settings-control-stack="true">
              <section
                aria-label={labels.profile}
                className="grid gap-4 sm:grid-cols-[auto_minmax(0,1fr)] sm:items-start"
                data-settings-account-identity="true"
              >
                <div className="grid place-items-center gap-2 sm:w-28" data-settings-avatar-panel="true">
                  <div className="relative rounded-full border border-border bg-muted/30 p-1 shadow-xs">
                    <MemberAvatar
                      identity={{
                        id: "local-user",
                        name: profile.displayName,
                        handle: profile.handle,
                        avatar: profile.avatar,
                      }}
                      large
                    />
                    <Button
                      aria-label={labels.avatarRandomize}
                      className="absolute -bottom-1 -right-1 size-8 rounded-full border border-background bg-background shadow-sm [&_svg]:size-3.5"
                      data-settings-avatar-randomize="true"
                      disabled={profilePending}
                      onClick={() => {
                        const avatar = randomProfileAvatarPresetId(profile.avatar);
                        runSettingsFireAndForgetAction(() => input.onProfileChange?.({ avatar }));
                      }}
                      size="icon"
                      type="button"
                      variant="outline"
                    >
                      <SleiIcon name="refreshCw" />
                    </Button>
                  </div>
                  <input
                    accept=".png,.jpg,.jpeg,.webp,image/png,image/jpeg,image/webp"
                    aria-label={labels.avatarUpload}
                    className="hidden"
                    data-settings-avatar-upload="true"
                    disabled={avatarUploadDisabled}
                    id={avatarUploadId}
                    ref={avatarUploadInputRef}
                    onChange={(event) => {
                      const file = event.currentTarget.files?.[0];
                      event.currentTarget.value = "";
                      if (!file || avatarUploadDisabled) return;
                      runSettingsFireAndForgetAction(() => input.onProfileAvatarUpload?.(file));
                    }}
                    type="file"
                  />
                  <Button
                    data-settings-avatar-upload-trigger="true"
                    disabled={avatarUploadDisabled}
                    onClick={() => avatarUploadInputRef.current?.click()}
                    size="xs"
                    type="button"
                    variant="outline"
                  >
                    {labels.avatarUpload}
                  </Button>
                </div>
                <div className="grid min-w-0 gap-3" data-settings-profile-fields="true">
                  <div className="grid gap-1">
                    <h2 className="text-sm font-medium">{labels.avatar}</h2>
                    <p className="text-sm text-muted-foreground">{labels.avatarHint}</p>
                  </div>
                  <EditableDetailField
                    ariaLabel={`${input.messages.common.edit}${labels.displayName}`}
                    error={input.profileErrors?.displayName}
                    label={labels.displayName}
                    messages={input.messages}
                    onSave={(value) => input.onProfileChange?.({ displayName: value })}
                    saving={profilePending}
                    sectionClassName="grid gap-2 rounded-md border border-border/60 bg-muted/20 p-3"
                    value={profile.displayName}
                  />
                  <div className="grid gap-1 rounded-md border border-border/60 bg-muted/20 p-3">
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-sm font-medium">{labels.handle}</span>
                      <span className="truncate font-mono text-sm text-foreground">{profile.handle.startsWith("@") ? profile.handle : `@${profile.handle}`}</span>
                    </div>
                    <p className="text-xs text-muted-foreground">{labels.handleReadOnly}</p>
                  </div>
                </div>
                {input.profileErrors?.avatar ? (
                  <p className="text-sm text-destructive" role="alert">
                    {input.profileErrors.avatar}
                  </p>
                ) : null}
              </section>
              </CardContent>
            </Card>
          ) : null}

          {input.activePanel === "language-region" ? (
            <Card className={settingsSectionCardClass}>
              <CardContent className={cn("p-4", settingsControlStackClass)} data-settings-control-stack="true">
              <div data-preference-pending={input.pendingPreference === "locale" ? "locale" : undefined}>
                <SettingsSelect
                  ariaLabel={labels.language}
                  disabled={preferencePending}
                  id="language"
                  label={labels.language}
                  onValueChange={(value) => runSettingsFireAndForgetAction(() => input.onLocaleChange?.(value))}
                  options={[
                    { label: labels.languageNames["zh-CN"], value: "zh-CN" },
                    { label: labels.languageNames["en-US"], value: "en-US" },
                  ]}
                  value={input.locale}
                />
              </div>
              <div data-preference-pending={input.pendingPreference === "timeZone" ? "timeZone" : undefined}>
                <SettingsSelect
                  ariaLabel={labels.timeZone}
                  disabled={preferencePending}
                  id="timezone"
                  label={labels.timeZone}
                  onValueChange={(value) => runSettingsFireAndForgetAction(() => input.onTimeZoneChange?.(value))}
                  options={timeZoneOptions}
                  value={input.timeZone || defaultTimeZone}
                />
              </div>
              {input.preferenceError ? (
                <p className="text-sm text-destructive" role="alert">
                  {input.preferenceError}
                </p>
              ) : null}
              </CardContent>
            </Card>
          ) : null}

          {input.activePanel === "appearance" ? (
            <Card className={settingsSectionCardClass}>
              <CardContent className={cn("p-4", settingsControlStackClass)} data-preference-pending={input.pendingPreference === "appearance" ? "appearance" : undefined} data-settings-control-stack="true">
              <PreferenceRow
                control={(
                  <div className="grid gap-2 sm:grid-cols-2" data-settings-theme-selected={activeTheme} role="group">
                    {themeOptions(labels).map((option) => (
                      <Button
                        aria-pressed={activeTheme === option.value ? "true" : "false"}
                        className={cn("justify-start", activeTheme === option.value && "ring-2 ring-ring")}
                        data-settings-theme-option={option.value}
                        disabled={preferencePending}
                        key={option.value}
                        onClick={() => updateAppearance({ theme: option.value })}
                        type="button"
                        variant={activeTheme === option.value ? "secondary" : "outline"}
                      >
                        {option.label}
                      </Button>
                    ))}
                  </div>
                )}
                label={labels.theme}
                labelMode="group"
              />

              <Separator />

              <PreferenceRow
                control={(
                  <div className="flex flex-wrap gap-2" role="group">
                    {(["sm", "md", "lg"] as const).map((size) => (
                      <Button
                        aria-pressed={input.appearance.fontSize === size ? "true" : "false"}
                        data-settings-font-size-option={size}
                        disabled={preferencePending}
                        key={size}
                        onClick={() => updateAppearance({ fontSize: size })}
                        type="button"
                        variant={input.appearance.fontSize === size ? "secondary" : "outline"}
                      >
                        {labels.fontSizes[size]}
                      </Button>
                    ))}
                  </div>
                )}
                label={labels.fontSize}
                labelMode="group"
              />
              {input.preferenceError ? (
                <p className="text-sm text-destructive" role="alert">
                  {input.preferenceError}
                </p>
              ) : null}
              </CardContent>
            </Card>
          ) : null}

          {input.activePanel === "notifications" ? (
            <Card className={settingsSectionCardClass}>
              <CardContent className={cn("p-4", settingsControlStackClass)} data-preference-pending={input.pendingPreference === "notifications" ? "notifications" : undefined} data-settings-control-stack="true">
              <NotificationSwitch
                checked={input.notifications.mentions}
                disabled={preferencePending}
                label={labels.mentionNotifications}
                name="mentions"
                onCheckedChange={(checked) => updateNotification("mentions", checked)}
              />
              <NotificationSwitch
                checked={input.notifications.humanReplies}
                disabled={preferencePending}
                label={labels.humanReplyNotifications}
                name="humanReplies"
                onCheckedChange={(checked) => updateNotification("humanReplies", checked)}
              />
              <NotificationSwitch
                checked={input.notifications.approvals}
                disabled={preferencePending}
                label={labels.approvalNotifications}
                name="approvals"
                onCheckedChange={(checked) => updateNotification("approvals", checked)}
              />
              {input.preferenceError ? (
                <p className="text-sm text-destructive" role="alert">
                  {input.preferenceError}
                </p>
              ) : null}
              </CardContent>
            </Card>
          ) : null}

          {input.activePanel === "about" ? (
            <Card className={cn(settingsSectionCardClass, "overflow-hidden py-0")}>
              <CardContent className="p-0" data-settings-about-list="compact">
                <dl className="divide-y divide-border/70" data-slot="settings-about-definition-list">
                  <AboutRow label={labels.desktopVersion} value={desktopVersion} />
                  <AboutRow label={labels.daemonVersion} value={input.nodes[0]?.daemonVersion ?? "unknown"} />
                  <AboutRow label={labels.connectedComputers} value={String(input.nodes.length)} />
                </dl>
              </CardContent>
            </Card>
          ) : null}
        </div>
      </ScrollArea>
    </section>
  );
}

export function runSettingsFireAndForgetAction(action: () => Promise<void> | void) {
  void Promise.resolve()
    .then(action)
    .catch(() => undefined);
}

function SettingsSelect<TValue extends string>(input: {
  ariaLabel: string;
  disabled?: boolean;
  id: string;
  label: string;
  onValueChange: (value: TValue) => void;
  options: Array<SelectOption<TValue>>;
  value: TValue;
}) {
  const selectedLabel = input.options.find((option) => option.value === input.value)?.label ?? input.value;
  const labelId = `settings-select-label-${input.id}`;
  const renderStaticItems = typeof window === "undefined";

  return (
    <Field>
      <FieldLabel id={labelId}>{input.label}</FieldLabel>
      <Select {...(renderStaticItems ? { open: true } : {})} disabled={input.disabled} onValueChange={input.onValueChange} value={input.value}>
        <SelectTrigger aria-label={input.ariaLabel} aria-labelledby={labelId} className="w-full sm:max-w-sm" disabled={input.disabled}>
          <SelectValue placeholder={selectedLabel} />
        </SelectTrigger>
        {renderStaticItems ? (
          <SelectPrimitive.Content aria-hidden="true" className="hidden">
            <SelectPrimitive.Viewport>
              {input.options.map((option) => (
                <SelectItem data-value={option.value} key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectPrimitive.Viewport>
          </SelectPrimitive.Content>
        ) : null}
        <SelectContent>
          {input.options.map((option) => (
            <SelectItem data-value={option.value} key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Field>
  );
}

function NotificationSwitch(input: {
  checked: boolean;
  disabled?: boolean;
  label: string;
  name: keyof NotificationPreferences;
  onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <PreferenceRow
      control={(
        <Switch
          aria-label={input.label}
          checked={input.checked}
          disabled={input.disabled}
          id={`settings-notification-${input.name}`}
          onCheckedChange={input.onCheckedChange}
        />
      )}
      data-settings-notification={input.name}
      label={input.label}
    />
  );
}

function AboutRow(input: { label: string; value: string }) {
  return (
    <div
      className="grid min-h-12 gap-1 px-4 py-3 text-sm sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:gap-4 sm:px-5"
      data-settings-about-row={aboutRowKey(input.label)}
    >
      <dt className="min-w-0 text-muted-foreground">{input.label}</dt>
      <dd className="min-w-0 sm:justify-self-end">
        <Badge className="max-w-full font-medium" variant="outline">{input.value}</Badge>
      </dd>
    </div>
  );
}

function aboutRowKey(label: string) {
  if (/desktop/i.test(label) || label.includes("桌面")) return "desktopVersion";
  if (/daemon/i.test(label)) return "daemonVersion";
  return "connectedComputers";
}

function themeOptions(labels: DesktopMessages["settings"]): Array<SelectOption<"light" | "dark">> {
  return [
    { label: labels.themeLight, value: "light" },
    { label: labels.themeDark, value: "dark" },
  ];
}

function settingsPanelIcon(panel: SettingsPanel) {
  switch (panel) {
    case "account":
      return sleiIcons.user;
    case "language-region":
      return sleiIcons.globe;
    case "appearance":
      return sleiIcons.palette;
    case "notifications":
      return sleiIcons.bell;
    case "about":
      return sleiIcons.info;
  }
}

const timeZoneOptions = [
  { value: "Asia/Shanghai", label: "Asia/Shanghai" },
  { value: "America/Los_Angeles", label: "America/Los_Angeles" },
  { value: "America/New_York", label: "America/New_York" },
  { value: "Europe/London", label: "Europe/London" },
  { value: "UTC", label: "UTC" },
];
