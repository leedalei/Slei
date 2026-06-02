import { useEffect, useState } from "react";
import { ExternalLink, FileText, FolderOpen, type LucideIcon } from "lucide-react";

import type { DesktopMessages } from "../../i18n";
import type { AgentPathTarget, DesktopNodeView } from "../../lib/daemon-bridge";
import type { SleiFixtures } from "../../app/fixtures";
import { formatMemberCreatedDate, type AgentDraftInput } from "../../app/model";
import { EditableDetailField, Empty, MemberAvatar, StatusDot } from "../../app/shared-ui";
export function MembersPage(input: {
  activeMemberId?: string;
  data: SleiFixtures;
  messages: DesktopMessages;
  nodes: DesktopNodeView[];
  onAgentUpdate?: (agentId: string, update: Partial<AgentDraftInput>) => Promise<void> | void;
  onMessage?: (memberId: string) => void;
  onOpenAgentPath?: (agentId: string, target: AgentPathTarget) => Promise<void> | void;
}) {
  const selectedMember = input.data.members.find((member) => member.id === input.activeMemberId) ?? input.data.members[0];
  const tabs = [input.messages.members.profile, input.messages.members.workspace];
  const selectedNode = input.nodes.find((node) => node.id === selectedMember?.nodeId);
  const [memberDetails, setMemberDetails] = useState({
    description: selectedMember?.description ?? "",
    model: selectedMember?.model ?? "",
    name: selectedMember?.name ?? "",
    runtime: selectedMember?.runtime ?? "",
  });
  const [workspaceOpenError, setWorkspaceOpenError] = useState<string | undefined>(undefined);

  useEffect(() => {
    setMemberDetails({
      description: selectedMember?.description ?? "",
      model: selectedMember?.model ?? "",
      name: selectedMember?.name ?? "",
      runtime: selectedMember?.runtime ?? "",
    });
  }, [selectedMember?.id]);

  function updateMemberDetail(key: keyof typeof memberDetails, value: string) {
    setMemberDetails((current) => ({ ...current, [key]: value }));
    const updateKey = key === "runtime" ? "runtimeKind" : key;
    if (selectedMember?.type === "agent") {
      input.onAgentUpdate?.(selectedMember.id, { [updateKey]: value });
    }
  }

  async function openAgentPath(target: AgentPathTarget) {
    if (!selectedMember || selectedMember.type !== "agent") return;
    setWorkspaceOpenError(undefined);
    try {
      await input.onOpenAgentPath?.(selectedMember.id, target);
    } catch {
      setWorkspaceOpenError(input.messages.members.openWorkspaceFailed);
    }
  }

  if (!selectedMember) {
    return (
      <section className="slei-members-page slei-detail-empty-page">
        <Empty
          centered
          description={input.messages.members.emptyDescription}
          size="lg"
          title={input.messages.members.emptyTitle}
          variant="nodata"
        />
      </section>
    );
  }

  return (
    <section className="slei-members-page">
      <header className="slei-member-topbar">
        <div className="slei-member-titleline">
          <MemberAvatar identity={selectedMember} />
          <div>
            <h1>{memberDetails.name}</h1>
            <p>{memberDetails.description}</p>
          </div>
        </div>
        <div>
          <button className="slei-button" onClick={() => input.onMessage?.(selectedMember.id)} type="button">{input.messages.members.message}</button>
        </div>
      </header>
      <nav className="slei-member-tabs" aria-label={input.messages.members.memberConfig}>
        {tabs.map((tab, index) => (
          <button aria-current={index === 0 ? "page" : undefined} key={tab} type="button">{tab}</button>
        ))}
      </nav>
      <div className="slei-members-layout">
        <article aria-label={input.messages.members.detail} className="slei-member-detail">
          <header className="slei-profile-hero">
            <MemberAvatar identity={selectedMember} large />
            <div>
              <h2>{memberDetails.name} <StatusDot status={selectedMember.runtimeStatus} /> <span>{input.messages.members.online}</span></h2>
              <p><StatusDot status={selectedMember.runtimeStatus} />{memberDetails.name} · {selectedMember.handle}</p>
            </div>
          </header>
          <EditableDetailField ariaLabel={input.messages.members.editDisplayName} label={input.messages.members.displayName} messages={input.messages} onSave={(value) => updateMemberDetail("name", value)} value={memberDetails.name} />
          <EditableDetailField ariaLabel={input.messages.members.editDescription} label={input.messages.members.description} messages={input.messages} multiline onSave={(value) => updateMemberDetail("description", value)} value={memberDetails.description} />
          <section className="slei-detail-section">
            <h3>{input.messages.members.info}</h3>
            <dl>
              <div><dt>{input.messages.members.computer}</dt><dd>{selectedNode?.name ?? selectedMember.computer} <StatusDot status={selectedNode?.status === "offline" ? "offline" : "idle"} /> {selectedNode?.status ?? "connected"} · daemon {selectedNode?.daemonVersion ?? "v0.54.1"}</dd></div>
              <div><dt>{input.messages.members.created}</dt><dd>{formatMemberCreatedDate(selectedMember.created)}</dd></div>
              <div><dt>{input.messages.members.creator}</dt><dd>{selectedMember.creator}</dd></div>
            </dl>
          </section>
          <section className="slei-detail-section slei-runtime-config-section">
            <h3>{input.messages.members.runtimeConfig}</h3>
            <div className="slei-config-pills">
              <EditableDetailField ariaLabel={input.messages.members.editRuntime} label="Runtime" messages={input.messages} onSave={(value) => updateMemberDetail("runtime", value)} readClassName="slei-badge slei-badge--ready" sectionClassName="slei-config-editable" value={memberDetails.runtime} />
              <EditableDetailField ariaLabel={input.messages.members.editModel} label={input.messages.members.model} messages={input.messages} onSave={(value) => updateMemberDetail("model", value)} readClassName="slei-badge" sectionClassName="slei-config-editable" value={memberDetails.model} />
            </div>
          </section>
          <section className="slei-detail-section">
            <h3>{input.messages.members.workspace}</h3>
            <dl>
              <WorkspacePathRow
                icon={FolderOpen}
                label={input.messages.members.workspacePath}
                onOpen={() => openAgentPath("workspace")}
                path={selectedMember.workspacePath ?? "~/.slei/agents/" + selectedMember.id}
              />
              <WorkspacePathRow
                icon={FileText}
                label={input.messages.members.memoryFile}
                onOpen={() => openAgentPath("memory")}
                path={selectedMember.memoryPath ?? "~/.slei/agents/" + selectedMember.id + "/MEMORY.md"}
              />
              <WorkspacePathRow
                icon={FolderOpen}
                label={input.messages.members.docsFolder}
                onOpen={() => openAgentPath("docs")}
                path={selectedMember.docsPath ?? "~/.slei/agents/" + selectedMember.id + "/docs"}
              />
            </dl>
            {workspaceOpenError ? <p className="slei-inline-error">{workspaceOpenError}</p> : null}
            <p>{input.messages.members.defaultSkill(selectedMember.handle.replace(/^@/, ""))}</p>
          </section>
          <section className="slei-detail-section">
            <h3>{input.messages.members.skills}</h3>
            {selectedMember.skills?.length ? (
              <div className="slei-skill-grid">
                {selectedMember.skills.map((skill) => (
                  <article className="slei-skill-card" key={skill.id}>
                    <strong>{skill.name}</strong>
                    <p>{skill.trigger}</p>
                  </article>
                ))}
              </div>
            ) : (
              <Empty
                description={input.messages.members.noSkillsDescription}
                size="sm"
                title={input.messages.members.noSkills}
                variant="nodata"
              />
            )}
          </section>
        </article>
      </div>
    </section>
  );
}

function WorkspacePathRow(input: {
  icon: LucideIcon;
  label: string;
  onOpen: () => void;
  path: string;
}) {
  return (
    <div>
      <dt>{input.label}</dt>
      <dd>
        <button className="slei-workspace-link" onClick={input.onOpen} type="button">
          <input.icon aria-hidden="true" size={15} />
          <span>{input.path}</span>
          <ExternalLink aria-hidden="true" size={14} />
        </button>
      </dd>
    </div>
  );
}
