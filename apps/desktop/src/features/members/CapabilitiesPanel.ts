export type CapabilityView = {
  name: string;
  source: string;
  description: string;
  available: boolean;
  error?: string;
};

export function renderCapabilitiesPanel(input: {
  locale: "zh-CN" | "en-US";
  capabilities: CapabilityView[];
}): string {
  const messages = createDesktopMessages(input.locale).members;
  const title = messages.capabilities;
  const readOnly = messages.readOnly;
  const empty = messages.noCapabilities;

  if (input.capabilities.length === 0) {
    return `${title} ${readOnly} ${empty}`;
  }

  return [
    title,
    readOnly,
    ...input.capabilities.map((capability) =>
      [
        capability.available ? "available" : "unavailable",
        capability.name,
        capability.source,
        capability.description,
        capability.error ?? "",
      ]
        .filter(Boolean)
        .join(" "),
    ),
  ].join("\n");
}
import { createDesktopMessages } from "../../i18n";
