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
  const title = input.locale === "zh-CN" ? "能力" : "Capabilities";
  const readOnly = input.locale === "zh-CN" ? "只读" : "Read-only";
  const empty = input.locale === "zh-CN" ? "暂无能力" : "No capabilities";

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
