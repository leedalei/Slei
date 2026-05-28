import type { AgentView, HumanView } from "./types";

export function renderMembersSidebar(input: {
  locale: "zh-CN" | "en-US";
  agents: AgentView[];
  humans: HumanView[];
}): string {
  const humansLabel = input.locale === "zh-CN" ? "HUMANS" : "Humans";
  const emptyAgents = input.locale === "zh-CN" ? "还没有 Agent" : "No agents";
  return [
    "AGENTS",
    input.agents.length ? input.agents.map((agent) => agent.name).join(" ") : emptyAgents,
    humansLabel,
    input.humans.map((human) => `${human.name} @${human.handle}`).join(" "),
  ].join(" ");
}
