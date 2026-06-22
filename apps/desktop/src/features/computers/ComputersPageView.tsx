import { useEffect, useState, type ReactNode } from "react";
import { Bot, Calendar, Cpu, Monitor, Plus, Server, type LucideIcon } from "lucide-react";

import type { DesktopMessages } from "../../i18n";
import type { DesktopNodeView } from "../../lib/daemon-bridge";
import type { SleiMember } from "../../app/types";
import { agentsForComputerNode, deviceOsLabel, formatCreatedDate } from "../../app/model";
import { DetailBlock, EditableDetailField, Empty, MemberAvatar, StatusDot } from "../../components";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";

export function ComputersPage(input: {
  activeNodeId?: string;
  members: SleiMember[];
  messages: DesktopMessages;
  nodes: DesktopNodeView[];
  computerRenameError?: string;
  onComputerCreateRequest?: () => void;
  onComputerRename?: (nodeId: string, name: string) => Promise<void> | void;
  renamingComputerId?: string;
}) {
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
      <section className="grid min-h-full place-items-center p-6">
        <Empty
          centered
          description={input.messages.computers.emptyDescription}
          size="lg"
          title={input.messages.computers.emptyTitle}
          variant="nodata"
        />
        {input.onComputerCreateRequest ? (
          <Button className="mt-4" onClick={input.onComputerCreateRequest} type="button">
            <Plus aria-hidden="true" className="size-4" />
            {input.messages.computers.newComputer}
          </Button>
        ) : null}
      </section>
    );
  }

  const hostedAgents = agentsForComputerNode(selectedNode, input.members);
  const effectiveRenamingNodeId = input.renamingComputerId ?? renamingNodeId;

  return (
    <section aria-label={input.messages.computers.computer} className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)] overflow-hidden bg-background">
      <header className="select-none border-b px-6 py-5" data-testid="slei-computer-detail-header" data-tauri-drag-region="deep">
        <div className="flex flex-wrap items-start justify-between gap-4" data-tauri-drag-region="deep">
          <div className="flex min-w-0 items-center gap-4" data-slot="workspace-titlebar" data-tauri-drag-region="deep">
            <span className="grid size-12 shrink-0 place-items-center rounded-lg border bg-muted text-muted-foreground" data-tauri-drag-region="deep">
              <Monitor aria-hidden="true" className="size-6" />
            </span>
            <div className="min-w-0 space-y-1" data-tauri-drag-region="deep">
              <div className="flex flex-wrap items-center gap-2" data-tauri-drag-region="deep">
                <h1 className="truncate text-2xl font-semibold" data-tauri-drag-region="deep">{selectedNode.name}</h1>
                <Badge variant={selectedNode.status === "connected" ? "secondary" : "outline"} className="gap-1" data-tauri-drag-region="deep">
                  <StatusDot status={selectedNode.status === "connected" ? "idle" : "offline"} />
                  {selectedNode.status === "connected" ? input.messages.computers.connected : input.messages.computers.offline}
                </Badge>
              </div>
              <p className="truncate text-sm text-muted-foreground" data-tauri-drag-region="deep">{selectedNode.device.hostname}</p>
            </div>
          </div>
        </div>
      </header>

      <ScrollArea className="min-h-0">
        <div className="mx-auto grid w-full max-w-5xl gap-4 p-6">
          <Card size="compact">
            <CardContent>
              <EditableDetailField
                ariaLabel={input.messages.computers.editDeviceName}
                error={renameError}
                key={selectedNode.id}
                label={input.messages.computers.deviceName}
                messages={input.messages}
                onSave={renameSelectedComputer}
                saving={effectiveRenamingNodeId === selectedNode.id}
                sectionClassName="grid gap-2"
                titleTag="h2"
                value={selectedNode.name}
              />
              <ControlledFieldAlert message={input.computerRenameError} />
            </CardContent>
          </Card>

          <Card size="compact">
            <CardHeader>
              <CardTitle>{input.messages.computers.info}</CardTitle>
              <CardDescription>{input.messages.computers.systemInfo}</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4">
              <dl className="grid gap-3 md:grid-cols-2">
                <InfoItem icon={Cpu} label={input.messages.computers.os}>
                  {deviceOsLabel(selectedNode.device)}
                </InfoItem>
                <InfoItem icon={Server} label={input.messages.computers.hostname}>
                  {selectedNode.device.hostname}
                </InfoItem>
                <InfoItem icon={Monitor} label={input.messages.computers.daemonVersion}>
                  <strong>{selectedNode.daemonVersion}</strong>
                </InfoItem>
                <InfoItem icon={Calendar} label={input.messages.computers.created}>
                  {formatCreatedDate(selectedNode.created) || "-"}
                </InfoItem>
              </dl>

              <DetailBlock aria-label={input.messages.computers.detectedRuntimes} data-detail-block-kind="runtime" title={input.messages.computers.detectedRuntimes}>
                <div className="flex flex-wrap gap-2">
                  {selectedNode.runtimes.map((runtime) => (
                    <Badge
                      data-runtime-readiness={runtime.readiness}
                      key={runtime.kind}
                      variant={runtime.readiness === "ready" ? "secondary" : "outline"}
                    >
                      {runtime.kind}{runtime.version ? ` ${runtime.version}` : runtime.readiness === "ready" ? "" : ` (${input.messages.computers.offline})`}
                    </Badge>
                  ))}
                </div>
              </DetailBlock>
            </CardContent>
          </Card>

          <Card size="compact">
            <CardHeader>
              <CardTitle>{input.messages.computers.agentsOnThisComputer}</CardTitle>
              <CardAction>
                <Badge variant="outline">
                  <Bot aria-hidden="true" className="size-3" />
                  {hostedAgents.length}
                </Badge>
              </CardAction>
            </CardHeader>
            <CardContent>
              {hostedAgents.length ? (
                <div className="grid gap-3 md:grid-cols-2">
                  {hostedAgents.map((member) => (
                    <DetailBlock data-detail-block-kind="hosted-agent" key={member.id}>
                      <article className="grid grid-cols-[auto_1fr] gap-3">
                        <MemberAvatar identity={member} />
                        <div className="min-w-0">
                          <strong className="block truncate text-sm">{member.name}</strong>
                          <p className="truncate text-sm text-muted-foreground">{member.runtime}</p>
                          <p className="mt-1 text-sm text-muted-foreground">
                            <StatusDot status={member.runtimeStatus} /> {runtimeStatusLabel(member.runtimeStatus, input.messages)}
                          </p>
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

function InfoItem(input: { children: ReactNode; icon: LucideIcon; label: string }) {
  return (
    <DetailBlock>
      <dt className="inline-flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        <input.icon aria-hidden="true" className="size-3.5" />
        {input.label}
      </dt>
      <dd className="break-words text-sm">{input.children}</dd>
    </DetailBlock>
  );
}
