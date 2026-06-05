import { SettingsPage } from "../../features/settings/SettingsPageView";

export function SettingsRoute(props: Parameters<typeof SettingsPage>[0]) {
  return <SettingsPage {...props} />;
}
