import { useEffect, useState, type ReactNode } from "react";
import {
  CalendarDays,
  Cpu,
  ExternalLink,
  FileText,
  FolderOpen,
  MessageCircle,
  ShieldCheck,
  Sparkles,
  Trash2,
  UserRound,
  type LucideIcon,
} from "lucide-react";

import type { DesktopMessages } from "../../i18n";
import type { AgentPathTarget, DesktopNodeView } from "../../lib/daemon-bridge";
import type { SleiFixtures } from "../../app/fixtures";
import { formatMemberCreatedDate, type AgentDraftInput } from "../../app/model";
import { EditableDetailField, Empty, MemberAvatar, StatusDot } from "../../components";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

type MemberTab = "profile" | "workspace" | "capabilities";

export function MembersPage(input: {
  activeMemberId?: string;
  data: SleiFixtures;
  messages: DesktopMessages;
  nodes: DesktopNodeView[];
  onAgentDelete?: (agentId: string) => Promise<void> | void;
  onAgentUpdate?: (agentId: string, update: Partial<AgentDraftInput>) => Promise<void> | void;
  onMessage?: (memberId: string) => void;
  onOpenAgentPath?: (agentId: string, target: AgentPathTarget) => Promise<void> | void;
}) {
  const selectedMember = input.data.members.find((member) => member.id === input.activeMemberId) ?? input.data.members[0];
  const selectedNode = input.nodes.find((node) => node.id === selectedMember?.nodeId);
  const [activeTab, setActiveTab] = useState<MemberTab>("profile");
  const [memberDetails, setMemberDetails] = useState({
    description: selectedMember?.description ?? "",
    model: selectedMember?.model ?? "",
    name: selectedMember?.name ?? "",
    runtime: selectedMember?.runtime ?? "",
  });
  const [workspaceOpenError, setWorkspaceOpenError] = useState<string | undefined>(undefined);
  const [deleteError, setDeleteError] = useState<string | undefined>(undefined);
  const [deleting, setDeleting] = useState(false);

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

  async function deleteSelectedAgent() {
    if (!selectedMember || selectedMember.type !== "agent") return;
    if (selectedMember.systemOwned || selectedMember.directMessageEnabled === false) return;
    const confirmed = typeof window === "undefined"
      ? true
      : window.confirm(input.messages.members.deleteAgentConfirm(selectedMember.name));
    if (!confirmed) return;
    setDeleting(true);
    setDeleteError(undefined);
    try {
      await input.onAgentDelete?.(selectedMember.id);
    } catch {
      setDeleteError(input.messages.members.deleteAgentFailed);
    } finally {
      setDeleting(false);
    }
  }

  if (!selectedMember) {
    return (
      <section className="grid min-h-full place-items-center p-6">
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

  const canMessage = selectedMember.directMessageEnabled !== false;
  const canDelete = selectedMember.type === "agent" && !selectedMember.systemOwned && selectedMember.directMessageEnabled !== false;
  const workspaceBasePath = selectedMember.workspacePath ?? "~/.slei/agents/" + selectedMember.id;
  const memoryPath = selectedMember.memoryPath ?? workspaceBasePath + "/MEMORY.md";
  const docsPath = selectedMember.docsPath ?? workspaceBasePath + "/docs";
  const nodeStatus = selectedNode?.status ?? "connected";
  const nodeDotStatus = selectedNode?.status === "offline" ? "offline" : "idle";

  return (
    <section className="!grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)] overflow-hidden" aria-label={input.messages.members.detail}>
      <header className="border-b bg-background px-6 py-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 items-center gap-4">
            <MemberAvatar identity={selectedMember} large />
            <div className="min-w-0 space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="truncate text-2xl font-semibold">{memberDetails.name}</h1>
                <Badge variant="outline" className="gap-1">
                  <StatusDot status={selectedMember.runtimeStatus} />
                  {input.messages.members.online}
                </Badge>
              </div>
              <p className="text-sm text-muted-foreground">{selectedMember.role}</p>
              <p className="truncate text-sm text-muted-foreground">{selectedMember.handle}</p>
            </div>
          </div>
          {canMessage ? (
            <div className="flex flex-wrap items-center gap-2">
              <Button onClick={() => input.onMessage?.(selectedMember.id)} type="button">
                <MessageCircle aria-hidden="true" />
                {input.messages.members.message}
              </Button>
              {canDelete ? (
                <Button
                  disabled={deleting}
                  onClick={() => void deleteSelectedAgent()}
                  title={input.messages.members.deleteAgentConfirm(selectedMember.name)}
                  type="button"
                  variant="destructive"
                >
                  <Trash2 aria-hidden="true" />
                  {input.messages.members.deleteAgent}
                </Button>
              ) : null}
            </div>
          ) : null}
        </div>
        {deleteError ? (
          <Alert className="mt-4" variant="destructive">
            <AlertDescription>{deleteError}</AlertDescription>
          </Alert>
        ) : null}
      </header>

      <Tabs className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)] gap-0" value={activeTab} onValueChange={(value) => setActiveTab(value as MemberTab)}>
        <div className="border-b px-6 py-3">
          <TabsList aria-label={input.messages.members.memberConfig} variant="line">
            <TabsTrigger value="profile">{input.messages.members.profile}</TabsTrigger>
            <TabsTrigger value="workspace">{input.messages.members.workspace}</TabsTrigger>
            <TabsTrigger value="capabilities">{input.messages.members.capabilities}</TabsTrigger>
          </TabsList>
        </div>

        <ScrollArea className="min-h-0">
          <div className="grid gap-4 p-6">
            <TabsContent forceMount value="profile" className="grid gap-4 data-[state=inactive]:hidden">
              <Card>
                <CardHeader>
                  <CardTitle>{input.messages.members.profile}</CardTitle>
                  <CardDescription>{memberDetails.description}</CardDescription>
                </CardHeader>
                <CardContent className="grid gap-4">
                  <div className="grid gap-4 md:grid-cols-2">
                    <EditableDetailField
                      ariaLabel={input.messages.members.editDisplayName}
                      label={input.messages.members.displayName}
                      messages={input.messages}
                      onSave={(value) => updateMemberDetail("name", value)}
                      sectionClassName="grid gap-2"
                      value={memberDetails.name}
                    />
                    <EditableDetailField
                      ariaLabel={input.messages.members.editDescription}
                      label={input.messages.members.description}
                      messages={input.messages}
                      multiline
                      onSave={(value) => updateMemberDetail("description", value)}
                      sectionClassName="grid gap-2"
                      value={memberDetails.description}
                    />
                  </div>
                  <Separator />
                  <h2 className="text-base font-semibold">{input.messages.members.info}</h2>
                  <div className="grid gap-3 md:grid-cols-3">
                    <InfoItem icon={Cpu} label={input.messages.members.computer}>
                      <span>{selectedNode?.name ?? selectedMember.computer}</span>
                      <span className="inline-flex items-center gap-1 text-muted-foreground">
                        <StatusDot status={nodeDotStatus} />
                        {nodeStatus} · daemon {selectedNode?.daemonVersion ?? "v0.54.1"}
                      </span>
                    </InfoItem>
                    <InfoItem icon={CalendarDays} label={input.messages.members.created}>
                      {formatMemberCreatedDate(selectedMember.created)}
                    </InfoItem>
                    <InfoItem icon={UserRound} label={input.messages.members.creator}>
                      {selectedMember.creator}
                    </InfoItem>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>{input.messages.members.runtimeConfig}</CardTitle>
                  <CardDescription>{selectedMember.runtimeStatus}</CardDescription>
                </CardHeader>
                <CardContent className="grid gap-4 sm:grid-cols-2">
                  <EditableDetailField
                    ariaLabel={input.messages.members.editRuntime}
                    label="Runtime"
                    messages={input.messages}
                    onSave={(value) => updateMemberDetail("runtime", value)}
                    readClassName="w-fit rounded-4xl border border-border px-2 py-0.5 text-xs font-medium text-foreground"
                    sectionClassName="grid gap-2"
                    value={memberDetails.runtime}
                  />
                  <EditableDetailField
                    ariaLabel={input.messages.members.editModel}
                    label={input.messages.members.model}
                    messages={input.messages}
                    onSave={(value) => updateMemberDetail("model", value)}
                    readClassName="w-fit rounded-4xl border border-border px-2 py-0.5 text-xs font-medium text-foreground"
                    sectionClassName="grid gap-2"
                    value={memberDetails.model}
                  />
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent forceMount value="workspace" className="grid gap-4 data-[state=inactive]:hidden">
              <Card>
                <CardHeader>
                  <CardTitle>{input.messages.members.workspace}</CardTitle>
                  <CardDescription>{input.messages.members.defaultSkill(selectedMember.handle.replace(/^@/, ""))}</CardDescription>
                </CardHeader>
                <CardContent className="grid gap-3">
                  <dl className="grid gap-3">
                    <WorkspacePathRow
                      icon={FolderOpen}
                      label={input.messages.members.workspacePath}
                      onOpen={() => openAgentPath("workspace")}
                      path={workspaceBasePath}
                    />
                    <WorkspacePathRow
                      icon={FileText}
                      label={input.messages.members.memoryFile}
                      onOpen={() => openAgentPath("memory")}
                      path={memoryPath}
                    />
                    <WorkspacePathRow
                      icon={FolderOpen}
                      label={input.messages.members.docsFolder}
                      onOpen={() => openAgentPath("docs")}
                      path={docsPath}
                    />
                  </dl>
                  {workspaceOpenError ? (
                    <Alert variant="destructive">
                      <AlertDescription>{workspaceOpenError}</AlertDescription>
                    </Alert>
                  ) : null}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>{input.messages.members.skills}</CardTitle>
                </CardHeader>
                <CardContent>
                  {selectedMember.skills?.length ? (
                    <div className="grid gap-3 md:grid-cols-2">
                      {selectedMember.skills.map((skill) => (
                        <article className="rounded-lg border bg-muted/30 p-3" key={skill.id}>
                          <strong className="text-sm font-medium">{skill.name}</strong>
                          <p className="mt-1 text-sm text-muted-foreground">{skill.trigger}</p>
                        </article>
                      ))}
                    </div>
                  ) : (
                    <InlineEmpty
                      description={input.messages.members.noSkillsDescription}
                      title={input.messages.members.noSkills}
                    />
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent forceMount value="capabilities" className="grid gap-4 data-[state=inactive]:hidden">
              <Card>
                <CardHeader>
                  <CardTitle>{input.messages.members.capabilities}</CardTitle>
                  <CardDescription>{input.messages.members.readOnly}</CardDescription>
                </CardHeader>
                <CardContent>
                  {selectedMember.capabilities.length ? (
                    <div className="flex flex-wrap gap-2">
                      {selectedMember.capabilities.map((capability) => (
                        <Badge className="gap-1" key={capability} variant="secondary">
                          <Sparkles aria-hidden="true" />
                          {capability}
                        </Badge>
                      ))}
                    </div>
                  ) : (
                    <InlineEmpty
                      description={input.messages.members.capabilityScanUnavailable}
                      title={input.messages.members.noCapabilities}
                    />
                  )}
                </CardContent>
              </Card>

              {selectedMember.permissions.length ? (
                <Card>
                  <CardHeader>
                    <CardTitle>{input.messages.members.workspacePermission}</CardTitle>
                    <CardDescription>{input.messages.members.readOnly}</CardDescription>
                  </CardHeader>
                  <CardContent className="flex flex-wrap gap-2">
                    {selectedMember.permissions.map((permission) => (
                      <Badge className="gap-1" key={permission} variant="outline">
                        <ShieldCheck aria-hidden="true" />
                        {permission}
                      </Badge>
                    ))}
                  </CardContent>
                </Card>
              ) : null}
            </TabsContent>
          </div>
        </ScrollArea>
      </Tabs>
    </section>
  );
}

function InlineEmpty(input: { description: string; title: string }) {
  return (
    <div className="rounded-lg border border-dashed bg-muted/35 p-4" role="status">
      <strong className="text-sm font-medium">{input.title}</strong>
      <p className="mt-1 text-sm text-muted-foreground">{input.description}</p>
    </div>
  );
}

function InfoItem(input: {
  children: ReactNode;
  icon: LucideIcon;
  label: string;
}) {
  return (
    <div className="rounded-lg border bg-muted/30 p-3">
      <div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        <input.icon aria-hidden="true" className="size-3.5" />
        {input.label}
      </div>
      <div className="grid gap-1 text-sm">{input.children}</div>
    </div>
  );
}

function WorkspacePathRow(input: {
  icon: LucideIcon;
  label: string;
  onOpen: () => void;
  path: string;
}) {
  return (
    <div className="grid gap-2 rounded-lg border bg-muted/30 p-3">
      <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{input.label}</dt>
      <dd>
        <Button
          aria-label={`${input.label} ${input.path}`}
          className="h-auto min-h-9 w-full justify-start whitespace-normal text-left"
          onClick={input.onOpen}
          type="button"
          variant="outline"
        >
          <input.icon aria-hidden="true" />
          <span className="min-w-0 flex-1 break-all">{input.path}</span>
          <ExternalLink aria-hidden="true" />
        </Button>
      </dd>
    </div>
  );
}
