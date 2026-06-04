import type { AppearancePreferences, AppLocale, DesktopNodeView, NotificationPreferences } from "../../lib/daemon-bridge";
import type { DesktopMessages } from "../../i18n";
import { defaultTimeZone, desktopVersion, normalizeAppearanceTheme, profileAvatarPresets, type SettingsPanel, type UserProfile } from "../../app/model";
import { MemberAvatar } from "../../components/MemberAvatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { Select as SelectPrimitive } from "radix-ui";

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
  onProfileChange?: (profile: UserProfile) => void;
  onTimeZoneChange?: (timeZone: string) => Promise<void> | void;
  profile: UserProfile;
  timeZone: string;
};

type SelectOption<TValue extends string> = {
  label: string;
  value: TValue;
};

export function SettingsPage(input: SettingsPageInput) {
  const labels = input.messages.settings;
  const activeTheme = normalizeAppearanceTheme(input.appearance.theme);

  function updateProfile(patch: Partial<UserProfile>) {
    input.onProfileChange?.({ ...input.profile, ...patch });
  }

  function updateNotification(field: keyof NotificationPreferences, value: boolean) {
    input.onNotificationsChange?.({
      ...input.notifications,
      [field]: value,
    });
  }

  function updateAppearance(patch: Partial<AppearancePreferences>) {
    input.onAppearanceChange?.({
      ...input.appearance,
      ...patch,
    });
  }

  return (
    <section className="h-full min-h-0 overflow-hidden bg-background text-[var(--slei-font-size)]" data-settings-panel={input.activePanel}>
      <ScrollArea className="h-full min-h-0">
        <div className="mx-auto grid w-full max-w-4xl gap-4 p-4 sm:p-6">
          <header className="grid gap-1">
            <Badge className="w-fit" variant="secondary">{labels.title}</Badge>
            <h1 className="text-2xl font-semibold leading-tight">{labels.panelTitle[input.activePanel]}</h1>
            <p className="max-w-2xl text-sm text-muted-foreground">{labels.panelSubtitle[input.activePanel]}</p>
          </header>

          {input.activePanel === "account" ? (
            <Card>
              <CardHeader>
                <CardTitle>{labels.profile}</CardTitle>
                <CardDescription>{labels.accountSubtitle}</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-5">
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="grid gap-2">
                    <Label htmlFor="settings-display-name">{labels.displayName}</Label>
                    <Input
                      id="settings-display-name"
                      onChange={(event) => updateProfile({ displayName: event.currentTarget.value })}
                      value={input.profile.displayName}
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="settings-handle">{labels.handle}</Label>
                    <Input
                      id="settings-handle"
                      onChange={(event) => updateProfile({ handle: event.currentTarget.value })}
                      value={input.profile.handle}
                    />
                  </div>
                </div>

                <Separator />

                <section aria-label={labels.avatarPresets} className="grid gap-3">
                  <div className="grid gap-1">
                    <h2 className="text-sm font-medium">{labels.avatar}</h2>
                    <p className="text-sm text-muted-foreground">{labels.avatarHint}</p>
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {profileAvatarPresets.map((preset) => (
                      <Button
                        aria-label={preset.name}
                        aria-pressed={input.profile.avatar === preset.id ? "true" : "false"}
                        className={cn("h-auto justify-start gap-3 px-3 py-2", input.profile.avatar === preset.id && "ring-2 ring-ring")}
                        key={preset.id}
                        onClick={() => updateProfile({ avatar: preset.id })}
                        type="button"
                        variant={input.profile.avatar === preset.id ? "secondary" : "outline"}
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
                      </Button>
                    ))}
                  </div>
                </section>
              </CardContent>
            </Card>
          ) : null}

          {input.activePanel === "language-region" ? (
            <Card>
              <CardHeader>
                <CardTitle>{labels.languageRegion}</CardTitle>
                <CardDescription>{labels.languageRegionSubtitle}</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-4">
                <SettingsSelect
                  ariaLabel={labels.language}
                  id="language"
                  label={labels.language}
                  onValueChange={(value) => input.onLocaleChange?.(value)}
                  options={[
                    { label: labels.languageNames["zh-CN"], value: "zh-CN" },
                    { label: labels.languageNames["en-US"], value: "en-US" },
                  ]}
                  value={input.locale}
                />
                <SettingsSelect
                  ariaLabel={labels.timeZone}
                  id="timezone"
                  label={labels.timeZone}
                  onValueChange={(value) => input.onTimeZoneChange?.(value)}
                  options={timeZoneOptions}
                  value={input.timeZone || defaultTimeZone}
                />
              </CardContent>
            </Card>
          ) : null}

          {input.activePanel === "appearance" ? (
            <Card>
              <CardHeader>
                <CardTitle>{labels.appearance}</CardTitle>
                <CardDescription>{labels.appearanceSubtitle}</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-5">
                <div className="grid gap-2">
                  <Label>{labels.theme}</Label>
                  <div aria-label={labels.theme} className="grid gap-2 sm:grid-cols-2" data-settings-theme-selected={activeTheme} role="group">
                    {themeOptions(labels).map((option) => (
                      <Button
                        aria-pressed={activeTheme === option.value ? "true" : "false"}
                        className={cn("justify-start", activeTheme === option.value && "ring-2 ring-ring")}
                        data-settings-theme-option={option.value}
                        key={option.value}
                        onClick={() => updateAppearance({ theme: option.value })}
                        type="button"
                        variant={activeTheme === option.value ? "secondary" : "outline"}
                      >
                        {option.label}
                      </Button>
                    ))}
                  </div>
                </div>

                <Separator />

                <div className="grid gap-2">
                  <Label>{labels.fontSize}</Label>
                  <div className="flex flex-wrap gap-2" role="group" aria-label={labels.fontSize}>
                    {(["sm", "md", "lg"] as const).map((size) => (
                      <Button
                        aria-pressed={input.appearance.fontSize === size ? "true" : "false"}
                        key={size}
                        onClick={() => updateAppearance({ fontSize: size })}
                        type="button"
                        variant={input.appearance.fontSize === size ? "secondary" : "outline"}
                      >
                        {labels.fontSizes[size]}
                      </Button>
                    ))}
                  </div>
                </div>
              </CardContent>
            </Card>
          ) : null}

          {input.activePanel === "notifications" ? (
            <Card>
              <CardHeader>
                <CardTitle>{labels.notifications}</CardTitle>
                <CardDescription>{labels.notificationsSubtitle}</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-2">
                <NotificationSwitch
                  checked={input.notifications.mentions}
                  label={labels.mentionNotifications}
                  name="mentions"
                  onCheckedChange={(checked) => updateNotification("mentions", checked)}
                />
                <NotificationSwitch
                  checked={input.notifications.humanReplies}
                  label={labels.humanReplyNotifications}
                  name="humanReplies"
                  onCheckedChange={(checked) => updateNotification("humanReplies", checked)}
                />
                <NotificationSwitch
                  checked={input.notifications.approvals}
                  label={labels.approvalNotifications}
                  name="approvals"
                  onCheckedChange={(checked) => updateNotification("approvals", checked)}
                />
              </CardContent>
            </Card>
          ) : null}

          {input.activePanel === "about" ? (
            <Card>
              <CardHeader>
                <CardTitle>{labels.about}</CardTitle>
                <CardDescription>{labels.aboutSubtitle}</CardDescription>
              </CardHeader>
              <CardContent>
                <dl className="grid gap-3">
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

function SettingsSelect<TValue extends string>(input: {
  ariaLabel: string;
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
    <div className="grid gap-2">
      <Label id={labelId}>{input.label}</Label>
      <Select {...(renderStaticItems ? { open: true } : {})} onValueChange={input.onValueChange} value={input.value}>
        <SelectTrigger aria-label={input.ariaLabel} aria-labelledby={labelId} className="w-full sm:max-w-sm">
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
    </div>
  );
}

function NotificationSwitch(input: {
  checked: boolean;
  label: string;
  name: keyof NotificationPreferences;
  onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-lg border p-3" data-settings-notification={input.name}>
      <Label className="text-sm" htmlFor={`settings-notification-${input.name}`}>{input.label}</Label>
      <Switch
        aria-label={input.label}
        checked={input.checked}
        id={`settings-notification-${input.name}`}
        onCheckedChange={input.onCheckedChange}
      />
    </div>
  );
}

function AboutRow(input: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-lg border p-3">
      <dt className="text-sm text-muted-foreground">{input.label}</dt>
      <dd className="font-medium">{input.value}</dd>
    </div>
  );
}

function themeOptions(labels: DesktopMessages["settings"]): Array<SelectOption<"light" | "dark">> {
  return [
    { label: labels.themeLight, value: "light" },
    { label: labels.themeDark, value: "dark" },
  ];
}

const timeZoneOptions = [
  { value: "Asia/Shanghai", label: "Asia/Shanghai" },
  { value: "America/Los_Angeles", label: "America/Los_Angeles" },
  { value: "America/New_York", label: "America/New_York" },
  { value: "Europe/London", label: "Europe/London" },
  { value: "UTC", label: "UTC" },
];
