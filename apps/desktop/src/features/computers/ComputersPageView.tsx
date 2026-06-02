import { Monitor } from "lucide-react";

import type { DesktopMessages } from "../../i18n";
import type { DesktopNodeView } from "../../lib/daemon-bridge";
import type { SleiMember } from "../../app/fixtures";
import { agentsForComputerNode, deviceOsLabel } from "../../app/model";
import { EditableDetailField, Empty, MemberAvatar, StatusDot } from "../../app/shared-ui";
export function ComputersPage(input: {
  activeNodeId?: string;
  members: SleiMember[];
  messages: DesktopMessages;
  nodes: DesktopNodeView[];
  onComputerCreateRequest?: () => void;
  onComputerRename?: (nodeId: string, name: string) => void;
}) {
  const firstNode = input.nodes[0];
  const selectedNode = input.nodes.find((node) => node.id === input.activeNodeId) ?? firstNode;
  if (!selectedNode) {
    return (
      <section className="slei-computers-page slei-detail-empty-page">
        <Empty
          centered
          description={input.messages.computers.emptyDescription}
          size="lg"
          title={input.messages.computers.emptyTitle}
          variant="nodata"
        />
      </section>
    );
  }

  const hostedAgents = agentsForComputerNode(selectedNode, input.members);

  return (
    <section className="slei-computers-page">
      <article className="slei-computer-detail" aria-label={input.messages.computers.computer}>
        <header className="slei-computer-detail__top">
          <span className="slei-computer-icon slei-computer-icon--large"><Monitor aria-hidden="true" size={24} /></span>
          <div>
            <h1>{selectedNode.name}</h1>
            <p><StatusDot status={selectedNode.status === "connected" ? "idle" : "offline"} /> {selectedNode.status === "connected" ? input.messages.computers.connected : input.messages.computers.offline}</p>
            <small>{selectedNode.device.hostname}</small>
          </div>
        </header>

        <EditableDetailField
          ariaLabel={input.messages.computers.editDeviceName}
          label="NAME"
          messages={input.messages}
          onSave={(value) => input.onComputerRename?.(selectedNode.id, value)}
          sectionClassName="slei-computer-section"
          titleTag="h2"
          value={selectedNode.name}
        />

        <section className="slei-computer-section">
          <h2>{input.messages.computers.info}</h2>
          <dl className="slei-computer-info">
            <div><dt>{input.messages.computers.os}</dt><dd>{deviceOsLabel(selectedNode.device)}</dd></div>
            <div><dt>{input.messages.computers.hostname}</dt><dd>{selectedNode.device.hostname}</dd></div>
            <div><dt>{input.messages.computers.daemonVersion}</dt><dd><strong>{selectedNode.daemonVersion}</strong></dd></div>
            <div><dt>{input.messages.computers.created}</dt><dd>{selectedNode.created ?? "May 26, 2026"}</dd></div>
          </dl>
          <div className="slei-computer-runtimes">
            <h3>{input.messages.computers.detectedRuntimes}</h3>
            <div>
              {selectedNode.runtimes.map((runtime) => (
                <span className={`slei-runtime-pill slei-runtime-pill--${runtime.readiness}`} key={runtime.kind}>
                  {runtime.kind}{runtime.version ? ` ${runtime.version}` : runtime.readiness === "ready" ? "" : ` (${input.messages.computers.offline})`}
                </span>
              ))}
            </div>
          </div>
        </section>

        <section className="slei-computer-section slei-computer-agents">
          <div className="slei-computer-section__toolbar">
            <h2>{input.messages.computers.agentsOnThisComputer} <span>{hostedAgents.length}</span></h2>
          </div>
          <div className="slei-computer-agent-list">
            {hostedAgents.length ? hostedAgents.map((member) => (
              <div className="slei-computer-agent-row" key={member.id}>
                <MemberAvatar identity={member} />
                <strong>{member.name}</strong>
                <small>{member.runtime}</small>
                <span><StatusDot status={member.runtimeStatus} /> {runtimeStatusLabel(member.runtimeStatus, input.messages)}</span>
              </div>
            )) : <p>{input.messages.computers.noAgents}</p>}
          </div>
        </section>
      </article>

    </section>
  );
}

function runtimeStatusLabel(status: "idle" | "busy" | "offline", messages: DesktopMessages) {
  return messages.status.runtime[status];
}
