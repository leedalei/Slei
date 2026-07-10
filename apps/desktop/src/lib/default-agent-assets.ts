import {
  DEFAULT_KEY_KNOWLEDGE,
  DEFAULT_SKILL_DEFINITIONS,
  GUIDE_CREATE_SKILL,
  INITIAL_MEMORY_TEMPLATE,
  MEMORY_SKILL_TEMPLATE,
} from "./default-agent-assets.generated";

export type AgentTemplateInput = {
  name: string;
  handle: string;
  profession: string;
  description: string;
  agentKind?: string;
  channelIds?: string[];
};

export type DefaultSkillView = {
  id: string;
  name: string;
  trigger: string;
  path: string;
};

export function renderInitialMemory(input: AgentTemplateInput): string {
  return renderTemplate(INITIAL_MEMORY_TEMPLATE, {
    name: input.name,
    handle: input.handle,
    profession: input.profession,
    description: input.description,
    key_knowledge: renderKeyKnowledge(input),
  });
}

export function renderMemorySkill(input: Pick<AgentTemplateInput, "handle">): string {
  return renderTemplate(MEMORY_SKILL_TEMPLATE, { handle: input.handle });
}

export function guideCreateSkill(): string {
  return GUIDE_CREATE_SKILL;
}

export function defaultSkillViews(input: { handle: string; kind?: string; workspacePath: string }): DefaultSkillView[] {
  return DEFAULT_SKILL_DEFINITIONS.filter((definition) => matchesAgentKind(definition.agentKinds, input.kind))
    .map((definition) => ({
      id: definition.id,
      name: definition.name,
      trigger: renderTrigger(definition, input.handle),
      path: `${input.workspacePath}/${definition.relativePath}`,
    }))
    .sort((left, right) => left.id.localeCompare(right.id));
}

export function defaultSkillContent(input: { skillId: string; handle: string }): string {
  if (input.skillId === "guide-create") return guideCreateSkill();
  return renderMemorySkill({ handle: input.handle });
}

function renderKeyKnowledge(input: AgentTemplateInput): string {
  void input.channelIds;
  return (
    input.agentKind === "guide"
      ? DEFAULT_KEY_KNOWLEDGE.guide
      : DEFAULT_KEY_KNOWLEDGE.agent
  );
}

function renderTrigger(definition: (typeof DEFAULT_SKILL_DEFINITIONS)[number], handle: string): string {
  if ("trigger" in definition) return definition.trigger;
  return renderTemplate(definition.triggerTemplate, { handle });
}

function matchesAgentKind(agentKinds: readonly string[], kind = "agent") {
  return agentKinds.includes(kind) || (kind !== "guide" && agentKinds.includes("agent"));
}

function renderTemplate(template: string, replacements: Record<string, string>): string {
  return Object.entries(replacements).reduce(
    (rendered, [key, value]) => rendered.replaceAll(`{{${key}}}`, value),
    template,
  );
}
