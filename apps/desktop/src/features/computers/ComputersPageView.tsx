import { useEffect, useState, type ReactNode } from "react";

import type { DesktopMessages } from "../../i18n";
import type { DesktopNodeView } from "../../lib/daemon-bridge";
import type { SleiMember } from "../../app/types";
import { agentsForComputerNode, deviceOsLabel, formatCreatedDate } from "../../app/model";
import { DetailBlock, EditableDetailField, Empty, MemberAvatar, PageHeader, SleiIcon, StatusBadge, sleiIcons, type SleiIconName } from "../../components";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";

export function ComputersPage(input: {
  activeNodeId?: string;
  layout?: "workspace" | "settings";
  members: SleiMember[];
  messages: DesktopMessages;
  nodes: DesktopNodeView[];
  computerRenameError?: string;
  onComputerCreateRequest?: () => void;
  onComputerRename?: (nodeId: string, name: string) => Promise<void> | void;
  renamingComputerId?: string;
}) {
  const layout = input.layout ?? "workspace";
  const firstNode = input.nodes[0];
  const selectedNode = input.nodes.find((node) => node.id === input.activeNodeId) ?? firstNode;
  const [renamingNodeId, setRenamingNodeId] = useState<string | undefined>();
  const [renameError, setRenameError] = useState<string | undefined>();

  useEffect(() => {
    setRenameError(undefined);
  }, [selectedNode?.id]);

  async function renameSelectedComputer(name: string) {
    if (!selectedNode) return;
    setRenamingNodeId(selectedNode.id);
    setRenameError(undefined);
    try {
      await input.onComputerRename?.(selectedNode.id, name);
    } catch (error) {
      setRenameError(computerRenameErrorMessage(error));
      throw error;
    } finally {
      setRenamingNodeId((current) => (current === selectedNode.id ? undefined : current));
    }
  }

  if (!selectedNode) {
    return (
      <section
        className="grid min-h-full place-items-center p-6"
        data-settings-embedded-detail={layout === "settings" ? "devices" : undefined}
      >
        <Empty
          centered
          description={input.messages.computers.emptyDescription}
          size="lg"
          title={input.messages.computers.emptyTitle}
          variant="nodata"
        />
        {input.onComputerCreateRequest ? (
          <Button className="mt-4" onClick={input.onComputerCreateRequest} type="button">
            <SleiIcon className="size-4" name="plus" />
            {input.messages.computers.newComputer}
          </Button>
        ) : null}
      </section>
    );
  }

  const hostedAgents = agentsForComputerNode(selectedNode, input.members);
  const effectiveRenamingNodeId = input.renamingComputerId ?? renamingNodeId;

  return (
    <section
      aria-label={input.messages.computers.computer}
      className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)] overflow-hidden bg-transparent"
      data-settings-embedded-detail={layout === "settings" ? "devices" : undefined}
    >
      <div className="select-none border-b px-6 py-5" data-testid="slei-computer-detail-header" data-tauri-drag-region="deep">
        <PageHeader
          data-slot="workspace-titlebar"
          data-tauri-drag-region="deep"
          icon={sleiIcons.computer}
          subtitle={(
            <span className="grid min-w-0 gap-2" data-tauri-drag-region="deep">
              <span className="truncate text-sm text-muted-foreground" data-tauri-drag-region="deep">{selectedNode.device.hostname}</span>
              <StatusBadge
                className="w-fit"
                data-tauri-drag-region="deep"
                label={selectedNode.status === "connected" ? input.messages.computers.connected : input.messages.computers.offline}
                status={selectedNode.status}
              />
            </span>
          )}
          title={<span data-tauri-drag-region="deep">{selectedNode.name}</span>}
        />
      </div>

      <ScrollArea className="min-h-0">
        <div className="mx-auto grid w-full max-w-5xl gap-4 p-6">
          <Card className="overflow-visible text-card-foreground shadow-none">
            <CardContent className="p-5">
              <EditableDetailField
                ariaLabel={input.messages.computers.editDeviceName}
                error={renameError}
                key={selectedNode.id}
                label={input.messages.computers.deviceName}
                messages={input.messages}
                onSave={renameSelectedComputer}
                saving={effectiveRenamingNodeId === selectedNode.id}
                sectionClassName="grid gap-3"
                titleTag="h2"
                value={selectedNode.name}
              />
              <ControlledFieldAlert message={input.computerRenameError} />
            </CardContent>
          </Card>

          <Card className="text-card-foreground shadow-none">
            <CardContent className="grid gap-4 p-4">
              <div className="grid gap-1">
                <h2 className="text-base font-semibold">{input.messages.computers.info}</h2>
                <p className="text-sm text-muted-foreground">{input.messages.computers.systemInfo}</p>
              </div>
              <dl className="grid gap-3 md:grid-cols-2">
                <InfoItem icon="cpu" label={input.messages.computers.os}>
                  {deviceOsLabel(selectedNode.device)}
                </InfoItem>
                <InfoItem icon="server" label={input.messages.computers.hostname}>
                  {selectedNode.device.hostname}
                </InfoItem>
                <InfoItem icon="computer" label={input.messages.computers.daemonVersion}>
                  <strong>{selectedNode.daemonVersion}</strong>
                </InfoItem>
                <InfoItem icon="calendar" label={input.messages.computers.created}>
                  {formatCreatedDate(selectedNode.created) || "-"}
                </InfoItem>
              </dl>

              <DetailBlock aria-label={input.messages.computers.detectedRuntimes} data-detail-block-kind="runtime" title={input.messages.computers.detectedRuntimes}>
                <div className="flex flex-wrap gap-2">
                  {selectedNode.runtimes.map((runtime) => (
                    <StatusBadge
                      data-runtime-readiness={runtime.readiness}
                      key={runtime.kind}
                      label={`${runtime.kind}${runtime.version ? ` ${runtime.version}` : runtime.readiness === "ready" ? "" : ` (${input.messages.computers.offline})`}`}
                      status={runtime.readiness === "ready" ? "success" : "offline"}
                    />
                  ))}
                </div>
              </DetailBlock>
            </CardContent>
          </Card>

          <Card className="text-card-foreground shadow-none">
            <CardContent className="grid gap-4 p-4">
              <div className="flex min-w-0 items-center justify-between gap-3">
                <h2 className="text-base font-semibold">{input.messages.computers.agentsOnThisComputer}</h2>
                <div className="inline-flex items-center gap-1.5">
                  <SleiIcon className="size-3.5 text-muted-foreground" name="bot" />
                  <Badge variant="outline">{hostedAgents.length}</Badge>
                </div>
              </div>
              {hostedAgents.length ? (
                <div className="grid gap-3 md:grid-cols-2">
                  {hostedAgents.map((member) => (
                    <DetailBlock data-detail-block-kind="hosted-agent" key={member.id}>
                      <article className="grid grid-cols-[auto_1fr] gap-3">
                        <MemberAvatar identity={member} />
                        <div className="min-w-0">
                          <strong className="block truncate text-sm">{member.name}</strong>
                          <p className="truncate text-sm text-muted-foreground">{member.runtime}</p>
                          <StatusBadge className="mt-1 w-fit" label={runtimeStatusLabel(member.runtimeStatus, input.messages)} status={member.runtimeStatus} />
                        </div>
                      </article>
                    </DetailBlock>
                  ))}
                </div>
              ) : (
                <Empty
                  framed={false}
                  title={input.messages.computers.noAgents}
                  variant="nodata"
                />
              )}
            </CardContent>
          </Card>
        </div>
      </ScrollArea>
    </section>
  );
}

function computerRenameErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function ControlledFieldAlert(input: { message?: string }) {
  if (!input.message) return null;
  return (
    <p className="text-sm text-destructive" role="alert">
      {input.message}
    </p>
  );
}

function runtimeStatusLabel(status: "idle" | "busy" | "offline", messages: DesktopMessages) {
  return messages.status.runtime[status];
}

function InfoItem(input: { children: ReactNode; icon: SleiIconName; label: string }) {
  return (
    <div className="grid gap-2 rounded-lg border bg-muted/30 p-3 text-sm" data-slot="detail-block">
      <dt className="inline-flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        <SleiIcon className="size-3.5" name={input.icon} />
        {input.label}
      </dt>
      <dd className="break-words text-sm">{input.children}</dd>
    </div>
  );
}
