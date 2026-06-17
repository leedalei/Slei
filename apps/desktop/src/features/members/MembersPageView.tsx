import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  CalendarDays,
  ChevronDown,
  ChevronRight,
  Copy,
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
import type {
  AgentActivityListReceipt,
  AgentActivityLogView,
  AgentPathTarget,
  AgentWorkspaceEntry,
  AgentWorkspaceFileReceipt,
  AgentWorkspaceListReceipt,
  DesktopNodeView,
} from "../../lib/daemon-bridge";
import type { SleiFixtures, SleiMember } from "../../app/types";
import { formatMemberCreatedDate, type AgentDraftInput } from "../../app/model";
import { EditableDetailField, Empty, MemberAvatar, StatusDot, Toast, TOAST_VISIBLE_MS, type ToastType } from "../../components";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
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

type MemberTab = "profile" | "workspace" | "capabilities" | "activity";

type ClipboardWriter = {
  writeText?: (text: string) => Promise<void>;
};

async function copyPlainText(text: string) {
  const content = text.trim();
  if (!content) return false;
  const clipboard: ClipboardWriter | undefined = typeof navigator !== "undefined" ? navigator.clipboard : undefined;
  if (clipboard?.writeText) {
    await clipboard.writeText(content);
    return true;
  }
  if (typeof document === "undefined") return false;
  const textarea = document.createElement("textarea");
  textarea.value = content;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  const copied = document.execCommand("copy");
  document.body.removeChild(textarea);
  return copied;
}

export function MembersPage(input: {
  activeMemberId?: string;
  data: SleiFixtures;
  messages: DesktopMessages;
  nodes: DesktopNodeView[];
  onAgentDelete?: (agentId: string) => Promise<void> | void;
  onAgentUpdate?: (agentId: string, update: Partial<AgentDraftInput>) => Promise<void> | void;
  onListAgentWorkspace?: (agentId: string, relativePath?: string) => Promise<AgentWorkspaceListReceipt> | AgentWorkspaceListReceipt;
  onListAgentActivity?: (agentId: string, limit?: number) => Promise<AgentActivityListReceipt> | AgentActivityListReceipt;
  onMessage?: (memberId: string) => void;
  onOpenAgentPath?: (agentId: string, target: AgentPathTarget) => Promise<void> | void;
  onReadAgentWorkspaceFile?: (agentId: string, relativePath: string) => Promise<AgentWorkspaceFileReceipt> | AgentWorkspaceFileReceipt;
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
  const [activityLogs, setActivityLogs] = useState<AgentActivityLogView[]>([]);
  const [activityLoading, setActivityLoading] = useState(false);
  const [activityError, setActivityError] = useState<string | undefined>(undefined);
  const [expandedPayloadIds, setExpandedPayloadIds] = useState<Set<string>>(() => new Set());
  const [deleteError, setDeleteError] = useState<string | undefined>(undefined);
  const [deleting, setDeleting] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: ToastType }>({ message: "", type: "info" });
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const listAgentActivityRef = useRef(input.onListAgentActivity);
  const hasActivityLoader = Boolean(input.onListAgentActivity);
  const [workspaceEntriesByDirectory, setWorkspaceEntriesByDirectory] = useState<Record<string, AgentWorkspaceEntry[]>>(() => ({
    "": selectedMember ? initialWorkspaceEntries(selectedMember) : [],
  }));
  const [expandedWorkspaceDirectories, setExpandedWorkspaceDirectories] = useState<Set<string>>(() => new Set());
  const [activeWorkspaceFile, setActiveWorkspaceFile] = useState<AgentWorkspaceFileReceipt | undefined>(() =>
    selectedMember ? initialWorkspacePreview(selectedMember, input.messages) : undefined,
  );
  const workspaceBasePath = selectedMember?.workspacePath ?? "~/.slei/agents/" + (selectedMember?.id ?? "unknown");
  const memoryPath = selectedMember?.memoryPath ?? workspaceBasePath + "/MEMORY.md";
  const docsPath = selectedMember?.docsPath ?? workspaceBasePath + "/docs";

  useEffect(() => {
    setMemberDetails({
      description: selectedMember?.description ?? "",
      model: selectedMember?.model ?? "",
      name: selectedMember?.name ?? "",
      runtime: selectedMember?.runtime ?? "",
    });
  }, [selectedMember?.id]);

  useEffect(() => {
    setWorkspaceEntriesByDirectory({ "": selectedMember ? initialWorkspaceEntries(selectedMember) : [] });
    setExpandedWorkspaceDirectories(new Set());
    setActiveWorkspaceFile(selectedMember ? initialWorkspacePreview(selectedMember, input.messages) : undefined);
    if (selectedMember?.type === "agent" && input.onListAgentWorkspace) {
      void loadWorkspaceDirectory("");
    }
  }, [selectedMember?.id]);

  useEffect(() => {
    listAgentActivityRef.current = input.onListAgentActivity;
  });

  useEffect(() => {
    let mounted = true;
    setExpandedPayloadIds(new Set());
    setActivityLogs([]);
    setActivityError(undefined);
    if (!selectedMember || selectedMember.type !== "agent" || !hasActivityLoader) {
      setActivityLoading(false);
      return () => {
        mounted = false;
      };
    }
    setActivityLoading(true);
    void (async () => {
      try {
        const receipt = await listAgentActivityRef.current?.(selectedMember.id, 200);
        if (!mounted) return;
        setActivityLogs(receipt?.logs ?? []);
      } catch {
        if (!mounted) return;
        setActivityError(input.messages.members.activityLoadFailed);
      } finally {
        if (!mounted) return;
        setActivityLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [hasActivityLoader, input.messages.members.activityLoadFailed, selectedMember?.id, selectedMember?.type]);

  function updateMemberDetail(key: keyof typeof memberDetails, value: string) {
    setMemberDetails((current) => ({ ...current, [key]: value }));
    const updateKey = key === "runtime" ? "runtimeKind" : key;
    if (selectedMember?.type === "agent") {
      input.onAgentUpdate?.(selectedMember.id, { [updateKey]: value });
    }
  }

  function showToast(message: string, type: ToastType = "info") {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToast({ message, type });
    toastTimerRef.current = setTimeout(() => setToast((current) => ({ ...current, message: "" })), TOAST_VISIBLE_MS);
  }

  async function copyDescription() {
    const copied = await copyPlainText(memberDetails.description);
    if (!copied) return;
    showToast(input.messages.chat.copySuccess, "success");
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

  async function loadWorkspaceDirectory(relativePath: string) {
    if (!selectedMember || selectedMember.type !== "agent" || !input.onListAgentWorkspace) {
      return workspaceEntriesByDirectory[relativePath] ?? [];
    }
    setWorkspaceOpenError(undefined);
    try {
      const receipt = await input.onListAgentWorkspace(selectedMember.id, relativePath || undefined);
      setWorkspaceEntriesByDirectory((current) => ({
        ...current,
        [receipt.relativePath]: receipt.entries,
      }));
      return receipt.entries;
    } catch {
      setWorkspaceOpenError(input.messages.members.openWorkspaceFailed);
      return workspaceEntriesByDirectory[relativePath] ?? [];
    }
  }

  async function toggleWorkspaceDirectory(entry: AgentWorkspaceEntry) {
    if (expandedWorkspaceDirectories.has(entry.relativePath)) {
      setExpandedWorkspaceDirectories((current) => {
        const next = new Set(current);
        next.delete(entry.relativePath);
        return next;
      });
      return;
    }
    if (!workspaceEntriesByDirectory[entry.relativePath]) {
      await loadWorkspaceDirectory(entry.relativePath);
    }
    setExpandedWorkspaceDirectories((current) => new Set(current).add(entry.relativePath));
  }

  async function openWorkspaceEntry(entry: AgentWorkspaceEntry) {
    if (entry.kind === "directory") {
      await toggleWorkspaceDirectory(entry);
      return;
    }
    if (!selectedMember || selectedMember.type !== "agent" || !input.onReadAgentWorkspaceFile) {
      setActiveWorkspaceFile({
        agentId: selectedMember?.id ?? "",
        content: "",
        name: entry.name,
        relativePath: entry.relativePath,
      });
      return;
    }
    setWorkspaceOpenError(undefined);
    try {
      setActiveWorkspaceFile(await input.onReadAgentWorkspaceFile(selectedMember.id, entry.relativePath));
    } catch {
      setWorkspaceOpenError(input.messages.members.openWorkspaceFailed);
    }
  }

  async function deleteSelectedAgent() {
    if (!selectedMember || selectedMember.type !== "agent") return;
    if (selectedMember.systemOwned || selectedMember.directMessageEnabled === false) return;
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

  function toggleActivityPayload(logId: string) {
    setExpandedPayloadIds((current) => {
      const next = new Set(current);
      if (next.has(logId)) {
        next.delete(logId);
      } else {
        next.add(logId);
      }
      return next;
    });
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
  const showHandle = !selectedMember.id.startsWith("agent_coordinator_");
  const nodeStatus = selectedNode?.status ?? "connected";
  const nodeDotStatus = selectedNode?.status === "offline" ? "offline" : "idle";
  const workspaceRows = buildWorkspaceTreeRows({
    entriesByDirectory: workspaceEntriesByDirectory,
    expandedDirectories: expandedWorkspaceDirectories,
  });

  return (
    <section className="!grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)] overflow-hidden" aria-label={input.messages.members.detail}>
      <Toast message={toast.message} type={toast.type} />
      <header className="border-b bg-background px-6 py-5">
        <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-x-4 gap-y-3">
          <MemberAvatar identity={selectedMember} large />
          <div className="min-w-0 space-y-2">
            <div className="flex min-w-0 flex-wrap items-center gap-2" data-slot="workspace-titlebar" data-tauri-drag-region="deep">
              <h1 className="truncate text-2xl font-semibold">{memberDetails.name}</h1>
              {showHandle ? <span className="truncate text-xs text-muted-foreground">{selectedMember.handle}</span> : null}
              <Badge variant="outline" className="gap-1">
                <StatusDot status={selectedMember.runtimeStatus} />
                {input.messages.members.online}
              </Badge>
            </div>
            <div className="flex min-w-0 items-center gap-1.5">
              <p className="truncate text-sm text-muted-foreground">{memberDetails.description}</p>
              <Button aria-label={input.messages.chat.copyMessage} onClick={() => void copyDescription()} size="icon-xs" title={input.messages.chat.copyMessage} type="button" variant="ghost">
                <Copy aria-hidden="true" size={14} />
              </Button>
            </div>
          </div>
          {canMessage ? (
            <div className="col-start-3 row-start-1 flex flex-wrap items-center justify-end gap-2 self-start">
              <Button onClick={() => input.onMessage?.(selectedMember.id)} type="button">
                <MessageCircle aria-hidden="true" />
                {input.messages.members.message}
              </Button>
              {canDelete ? (
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button
                      disabled={deleting}
                      title={input.messages.members.deleteAgentConfirm(selectedMember.name)}
                      type="button"
                      variant="destructive"
                    >
                      <Trash2 aria-hidden="true" />
                      {input.messages.members.deleteAgent}
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>{input.messages.members.deleteAgent}</AlertDialogTitle>
                      <AlertDialogDescription>
                        {input.messages.members.deleteAgentConfirm(selectedMember.name)}
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>{input.messages.common.cancel}</AlertDialogCancel>
                      <AlertDialogAction onClick={() => void deleteSelectedAgent()} variant="destructive">
                        {input.messages.common.delete}
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
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
            <TabsTrigger value="activity">{input.messages.members.activity}</TabsTrigger>
          </TabsList>
        </div>

        <ScrollArea className="min-h-0">
          <div className="grid gap-4 p-6">
            <TabsContent forceMount value="profile" className="grid gap-4 data-[state=inactive]:hidden">
              <Card>
                <CardHeader>
                  <CardTitle>{input.messages.members.profile}</CardTitle>
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
              <section className="grid min-h-[28rem] overflow-hidden rounded-lg border bg-background md:grid-cols-[16rem_minmax(0,1fr)]" aria-label={input.messages.members.workspace}>
                <aside className="grid min-h-0 overflow-hidden border-b bg-muted/20 md:border-b-0 md:border-r">
                  <ScrollArea className="min-h-0">
                    <div className="grid gap-1 p-2">
                      {workspaceRows.map(({ depth, entry }) => {
                        const Icon = entry.kind === "directory" ? FolderOpen : FileText;
                        const expanded = expandedWorkspaceDirectories.has(entry.relativePath);
                        const DisclosureIcon = expanded ? ChevronDown : ChevronRight;
                        return (
                          <Button
                            aria-current={activeWorkspaceFile?.relativePath === entry.relativePath ? "true" : undefined}
                            className="w-full min-w-0 overflow-hidden justify-start gap-2 whitespace-nowrap px-2 py-2 text-left"
                            key={entry.relativePath}
                            onClick={() => void openWorkspaceEntry(entry)}
                            style={{ paddingLeft: `${0.5 + depth * 1}rem` }}
                            type="button"
                            variant={activeWorkspaceFile?.relativePath === entry.relativePath ? "secondary" : "ghost"}
                          >
                            {entry.kind === "directory" ? (
                              <DisclosureIcon aria-hidden="true" className="size-3 shrink-0 text-muted-foreground" />
                            ) : (
                              <span className="size-3 shrink-0" />
                            )}
                            <Icon aria-hidden="true" className="size-4 shrink-0" />
                            <span className="block min-w-0 flex-1 truncate">
                              {entry.name}{entry.kind === "directory" ? "/" : ""}
                            </span>
                          </Button>
                        );
                      })}
                    </div>
                  </ScrollArea>
                </aside>
                <article className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)]">
                  <header className="flex flex-wrap items-center justify-between gap-3 border-b p-3">
                    <div className="min-w-0">
                      <h2 className="text-sm font-semibold">{input.messages.members.filePreview}</h2>
                      <p className="truncate text-xs text-muted-foreground">{activeWorkspaceFile?.relativePath}</p>
                    </div>
                    <Button onClick={() => openAgentPath(pathTargetForWorkspaceFile(activeWorkspaceFile, memoryPath, docsPath))} type="button" variant="outline">
                      <ExternalLink aria-hidden="true" />
                      {input.messages.members.openInFileManager}
                    </Button>
                  </header>
                  <ScrollArea className="min-h-0">
                    <pre className="min-h-full whitespace-pre-wrap break-words p-4 font-mono text-xs leading-6 text-foreground">{activeWorkspaceFile?.content}</pre>
                  </ScrollArea>
                </article>
              </section>
              {workspaceOpenError ? (
                <Alert variant="destructive">
                  <AlertDescription>{workspaceOpenError}</AlertDescription>
                </Alert>
              ) : null}
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

            <TabsContent forceMount value="activity" className="grid gap-4 data-[state=inactive]:hidden">
              <Card>
                <CardHeader>
                  <CardTitle>{input.messages.members.activity}</CardTitle>
                  <CardDescription>{input.messages.members.readOnly}</CardDescription>
                </CardHeader>
                <CardContent>
                  {activityLoading ? (
                    <InlineEmpty
                      description={input.messages.members.activityLoading}
                      title={input.messages.members.activity}
                    />
                  ) : activityError ? (
                    <Alert variant="destructive">
                      <AlertDescription>{activityError}</AlertDescription>
                    </Alert>
                  ) : activityLogs.length ? (
                    <div className="grid gap-2">
                      {activityLogs.map((log) => (
                        <ActivityLogRow
                          expanded={expandedPayloadIds.has(log.id)}
                          key={log.id}
                          log={log}
                          messages={input.messages}
                          onTogglePayload={() => toggleActivityPayload(log.id)}
                        />
                      ))}
                    </div>
                  ) : (
                    <InlineEmpty
                      description={input.messages.members.noActivity}
                      title={input.messages.members.activity}
                    />
                  )}
                </CardContent>
              </Card>
            </TabsContent>
          </div>
        </ScrollArea>
      </Tabs>
    </section>
  );
}

function ActivityLogRow(input: {
  expanded: boolean;
  log: AgentActivityLogView;
  messages: DesktopMessages;
  onTogglePayload: () => void;
}) {
  const meta = [
    input.log.runId ? `runId ${input.log.runId}` : undefined,
    input.log.toolName ? `tool ${input.log.toolName}` : undefined,
    typeof input.log.ok === "boolean" ? (input.log.ok ? input.messages.members.activityOk : input.messages.members.activityFailed) : undefined,
    input.log.state ? `state ${input.log.state}` : undefined,
    input.log.phase ? `phase ${input.log.phase}` : undefined,
    input.log.reason ? `reason ${input.log.reason}` : undefined,
    input.log.channelId ? `channel ${input.log.channelId}` : undefined,
    input.log.messageId ? `message ${input.log.messageId}` : undefined,
    input.log.taskId ? `task ${input.log.taskId}` : undefined,
  ].filter((item): item is string => Boolean(item));
  const PayloadIcon = input.expanded ? ChevronDown : ChevronRight;

  return (
    <article className="grid gap-2 rounded-lg border bg-muted/20 p-3">
      <div className="grid gap-2 sm:grid-cols-[9rem_minmax(0,1fr)]">
        <time className="text-xs text-muted-foreground" dateTime={input.log.createdAt}>
          {formatActivityLogTime(input.log.createdAt)}
        </time>
        <div className="min-w-0 space-y-2">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <Badge variant="outline">{input.log.eventKind}</Badge>
            <Badge variant={input.log.severity === "error" ? "destructive" : "secondary"}>{input.log.severity}</Badge>
          </div>
          <p className="break-words text-sm font-medium">{input.log.summary}</p>
          {meta.length ? (
            <div className="flex flex-wrap gap-1.5">
              {meta.map((item) => (
                <span className="rounded-md border bg-background px-2 py-0.5 text-xs text-muted-foreground" key={item}>
                  {item}
                </span>
              ))}
            </div>
          ) : null}
        </div>
      </div>
      {input.log.payloadPreview ? (
        <div className="grid gap-2">
          <Button className="w-fit" onClick={input.onTogglePayload} type="button" variant="ghost">
            <PayloadIcon aria-hidden="true" className="size-4" />
            {input.expanded ? input.messages.members.collapsePayload : input.messages.members.expandPayload}
          </Button>
          {input.expanded ? (
            <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-lg border bg-background p-3 font-mono text-xs leading-5">
              {input.log.payloadPreview}
            </pre>
          ) : null}
        </div>
      ) : null}
    </article>
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

function initialWorkspaceEntries(member: SleiMember): AgentWorkspaceEntry[] {
  if (member.workspaceEntries) {
    return member.workspaceEntries;
  }
  return [];
}

function initialWorkspacePreview(member: SleiMember, _messages: DesktopMessages): AgentWorkspaceFileReceipt | undefined {
  if (member.workspaceFilePreview) {
    return {
      agentId: member.id,
      ...member.workspaceFilePreview,
    };
  }
  return undefined;
}

export function buildWorkspaceTreeRows(input: {
  entriesByDirectory: Record<string, AgentWorkspaceEntry[]>;
  expandedDirectories: Set<string>;
}): Array<{ depth: number; entry: AgentWorkspaceEntry }> {
  const rows: Array<{ depth: number; entry: AgentWorkspaceEntry }> = [];

  function append(directory: string, depth: number) {
    for (const entry of input.entriesByDirectory[directory] ?? []) {
      rows.push({ depth, entry });
      if (entry.kind === "directory" && input.expandedDirectories.has(entry.relativePath)) {
        append(entry.relativePath, depth + 1);
      }
    }
  }

  append("", 0);
  return rows;
}

function pathTargetForWorkspaceFile(file: AgentWorkspaceFileReceipt | undefined, memoryPath: string, docsPath: string): AgentPathTarget {
  if (!file) return "workspace";
  if (file.relativePath === "MEMORY.md" || file.relativePath === memoryPath) return "memory";
  if (file.relativePath === "docs" || file.relativePath.startsWith("docs/") || file.relativePath === docsPath) return "docs";
  return "workspace";
}

function formatActivityLogTime(createdAt: string) {
  const date = new Date(createdAt);
  if (Number.isNaN(date.getTime())) return createdAt;
  return date.toLocaleString();
}
