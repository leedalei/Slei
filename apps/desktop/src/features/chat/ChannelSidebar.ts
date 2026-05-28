export function renderChannelSidebar(channels: string[], active: string): string {
  return channels.map((channel) => `${channel === active ? "[active]" : ""}#${channel}`).join(" ");
}
