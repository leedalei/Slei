import type { ReactNode } from "react";
import { Bot, Calendar, Cpu, Monitor, Plus, Server, type LucideIcon } from "lucide-react";

import type { DesktopMessages } from "../../i18n";
import type { DesktopNodeView } from "../../lib/daemon-bridge";
import type { SleiMember } from "../../app/types";
import { agentsForComputerNode, deviceOsLabel } from "../../app/model";
import { EditableDetailField, Empty, MemberAvatar, StatusDot } from "../../components";
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
  onComputerCreateRequest?: () => void;
  onComputerRename?: (nodeId: string, name: string) => void;
}) {
  const firstNode = input.nodes[0];
  const selectedNode = input.nodes.find((node) => node.id === input.activeNodeId) ?? firstNode;
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

  return (
    <section aria-label={input.messages.computers.computer} className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)] overflow-hidden bg-background">
      <header className="border-b px-6 py-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 items-center gap-4" data-slot="workspace-titlebar" data-tauri-drag-region="deep">
            <span className="grid size-12 shrink-0 place-items-center rounded-lg border bg-muted text-muted-foreground">
              <Monitor aria-hidden="true" className="size-6" />
            </span>
            <div className="min-w-0 space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="truncate text-2xl font-semibold">{selectedNode.name}</h1>
                <Badge variant={selectedNode.status === "connected" ? "secondary" : "outline"} className="gap-1">
                  <StatusDot status={selectedNode.status === "connected" ? "idle" : "offline"} />
                  {selectedNode.status === "connected" ? input.messages.computers.connected : input.messages.computers.offline}
                </Badge>
              </div>
              <p className="truncate text-sm text-muted-foreground">{selectedNode.device.hostname}</p>
            </div>
          </div>
        </div>
      </header>

      <ScrollArea className="min-h-0">
        <div className="mx-auto grid w-full max-w-5xl gap-4 p-6">
          <Card>
            <CardContent className="p-4">
              <EditableDetailField
                ariaLabel={input.messages.computers.editDeviceName}
                label={input.messages.computers.deviceName}
                messages={input.messages}
                onSave={(value) => input.onComputerRename?.(selectedNode.id, value)}
                sectionClassName="grid gap-2"
                titleTag="h2"
                value={selectedNode.name}
              />
            </CardContent>
          </Card>

          <Card>
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
                  {selectedNode.created ?? "May 26, 2026"}
                </InfoItem>
              </dl>

              <section aria-label={input.messages.computers.detectedRuntimes} className="grid gap-3 rounded-lg border bg-muted/30 p-3">
                <h3 className="text-sm font-medium">{input.messages.computers.detectedRuntimes}</h3>
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
              </section>
            </CardContent>
          </Card>

          <Card>
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
                    <article className="grid grid-cols-[auto_1fr] gap-3 rounded-lg border bg-muted/30 p-3" key={member.id}>
                      <MemberAvatar identity={member} />
                      <div className="min-w-0">
                        <strong className="block truncate text-sm">{member.name}</strong>
                        <p className="truncate text-sm text-muted-foreground">{member.runtime}</p>
                        <p className="mt-1 text-sm text-muted-foreground">
                          <StatusDot status={member.runtimeStatus} /> {runtimeStatusLabel(member.runtimeStatus, input.messages)}
                        </p>
                      </div>
                    </article>
                  ))}
                </div>
              ) : (
                <p className="rounded-lg border border-dashed bg-muted/30 p-4 text-sm text-muted-foreground" role="status">
                  {input.messages.computers.noAgents}
                </p>
              )}
            </CardContent>
          </Card>
        </div>
      </ScrollArea>
    </section>
  );
}

function runtimeStatusLabel(status: "idle" | "busy" | "offline", messages: DesktopMessages) {
  return messages.status.runtime[status];
}

function InfoItem(input: { children: ReactNode; icon: LucideIcon; label: string }) {
  return (
    <div className="grid gap-2 rounded-lg border bg-muted/30 p-3">
      <dt className="inline-flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        <input.icon aria-hidden="true" className="size-3.5" />
        {input.label}
      </dt>
      <dd className="break-words text-sm">{input.children}</dd>
    </div>
  );
}
