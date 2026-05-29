import { createDesktopMessages } from "../../i18n";
import { renderFeatureShell } from "../shell/AppShell";
import { renderAgentForm } from "./AgentForm";
import { renderAgentProfile } from "./AgentProfile";
import { renderMembersSidebar } from "./MembersSidebar";
import type { AgentView, HumanView } from "./types";

export function renderMembersPage(input: {
  locale: "zh-CN" | "en-US";
  agents: AgentView[];
  humans: HumanView[];
}): string {
  const title = createDesktopMessages(input.locale).shell.nav.members;
  const sidebar = renderMembersSidebar(input);
  const content = [
    title,
    renderAgentForm(input.locale),
    ...input.agents.map((agent) => renderAgentProfile(agent, input.locale)),
  ].join(" ");

  return renderFeatureShell({
    active: "members",
    locale: input.locale,
    sidebar,
    content,
  });
}
