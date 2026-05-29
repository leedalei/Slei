import { createDesktopMessages } from "../../i18n";
import type { AgentView, HumanView } from "./types";

export function renderMembersSidebar(input: {
  locale: "zh-CN" | "en-US";
  agents: AgentView[];
  humans: HumanView[];
}): string {
  const messages = createDesktopMessages(input.locale).members;
  const humansLabel = input.locale === "en-US" ? "Humans" : "HUMANS";
  const emptyAgents = messages.noAgents;
  return [
    messages.agents,
    input.agents.length ? input.agents.map((agent) => agent.name).join(" ") : emptyAgents,
    humansLabel,
    input.humans.map((human) => `${human.name} @${human.handle}`).join(" "),
  ].join(" ");
}
