import { createDesktopMessages } from "../../i18n";

export type SkillCapabilityView = {
  name: string;
  source?: string;
  description: string;
  available?: boolean;
  error?: string;
};

export function renderCapabilitiesPanel(input: {
  locale: "zh-CN" | "en-US";
  skills: SkillCapabilityView[];
}): string {
  const messages = createDesktopMessages(input.locale).members;
  const title = messages.capabilities;

  if (input.skills.length === 0) {
    return `${title} ${messages.noSkills} ${messages.noSkillsDescription}`;
  }

  return [
    title,
    ...input.skills.map((skill) =>
      [
        skill.available === false ? "unavailable" : "available",
        skill.name,
        skill.source,
        skill.description,
        skill.error ?? "",
      ]
        .filter(Boolean)
        .join(" "),
    ),
  ].join("\n");
}
