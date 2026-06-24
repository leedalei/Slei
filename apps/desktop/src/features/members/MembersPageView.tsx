import { useEffect, useRef, useState, type ReactNode } from "react";

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
import { formatLocalRecordDateTime, formatMemberCreatedDate, type AgentDraftInput } from "../../app/model";
import {
  DetailBlock,
  EditableDetailField,
  Empty,
  MemberAvatar,
  PageHeader,
  SleiIcon,
  SoftPanel,
  StatusBadge,
  Toast,
  TOAST_VISIBLE_MS,
  TooltipButton,
  type SleiIconName,
  type ToastType,
} from "../../components";
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
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

type MemberTab = "profile" | "workspace" | "capabilities" | "permissions" | "activity";
type MemberEditableField = "description" | "model" | "name" | "runtime";

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
  memberFieldErrors?: Record<string, string>;
  onAgentDelete?: (agentId: string) => Promise<void> | void;
  onAgentUpdate?: (agentId: string, update: Partial<AgentDraftInput>) => Promise<void> | void;
  onListAgentWorkspace?: (agentId: string, relativePath?: string) => Promise<AgentWorkspaceListReceipt> | AgentWorkspaceListReceipt;
  onListAgentActivity?: (agentId: string, limit?: number) => Promise<AgentActivityListReceipt> | AgentActivityListReceipt;
  onMessage?: (memberId: string) => void;
  onOpenAgentPath?: (agentId: string, target: AgentPathTarget) => Promise<void> | void;
  onReadAgentWorkspaceFile?: (agentId: string, relativePath: string) => Promise<AgentWorkspaceFileReceipt> | AgentWorkspaceFileReceipt;
  savingMemberField?: string;
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
  const [savingField, setSavingField] = useState<MemberEditableField | undefined>();
  const [fieldError, setFieldError] = useState<Record<string, string>>({});
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
    setSavingField(undefined);
    setFieldError({});
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

  async function updateMemberDetail(key: MemberEditableField, value: string) {
    if (!selectedMember || selectedMember.type !== "agent") {
      setMemberDetails((current) => ({ ...current, [key]: value }));
      return;
    }

    setSavingField(key);
    setFieldError((current) => {
      const next = { ...current };
      delete next[key];
      return next;
    });
    const previousValue = memberDetails[key];
    setMemberDetails((current) => ({ ...current, [key]: value }));
    const updateKey = key === "runtime" ? "runtimeKind" : key;
    try {
      await input.onAgentUpdate?.(selectedMember.id, { [updateKey]: value } as Partial<AgentDraftInput>);
    } catch (error) {
      setMemberDetails((current) => ({ ...current, [key]: previousValue }));
      setFieldError((current) => ({ ...current, [key]: memberDetailErrorMessage(error) }));
      throw error;
    } finally {
      setSavingField((current) => (current === key ? undefined : current));
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
  const showHandle = true;
  const nodeStatus = selectedNode?.status ?? "connected";
  const nodeDotStatus = selectedNode?.status === "offline" ? "offline" : "idle";
  const workspaceRows = buildWorkspaceTreeRows({
    entriesByDirectory: workspaceEntriesByDirectory,
    expandedDirectories: expandedWorkspaceDirectories,
  });
  const effectiveSavingField = input.savingMemberField ?? savingField;
  const memberSkills = selectedMember.skills ?? [];

  return (
    <section className="!grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)] overflow-hidden" aria-label={input.messages.members.detail}>
      <Toast message={toast.message} type={toast.type} />
      <div className="select-none border-b bg-background px-6 py-5" data-testid="slei-member-detail-header" data-tauri-drag-region="deep">
        <div className="flex min-w-0 items-start gap-3" data-tauri-drag-region="deep">
          <span className="inline-flex shrink-0" data-tauri-drag-region="deep">
            <MemberAvatar identity={selectedMember} large />
          </span>
          <PageHeader
            className="min-w-0 flex-1 grid-cols-[minmax(0,1fr)_auto]"
            data-slot="workspace-titlebar"
            data-tauri-drag-region="deep"
            icon={undefined}
            title={<span className="min-w-0 truncate" data-tauri-drag-region="deep">{memberDetails.name}</span>}
            subtitle={(
              <span className="grid min-w-0 gap-2" data-tauri-drag-region="deep">
                <span className="flex min-w-0 flex-wrap items-center gap-2" data-tauri-drag-region="deep">
                  {showHandle ? <span className="truncate text-xs text-muted-foreground" data-tauri-drag-region="deep">{selectedMember.handle}</span> : null}
                  <StatusBadge
                    className="w-fit"
                    data-tauri-drag-region="deep"
                    label={input.messages.members.online}
                    status={selectedMember.runtimeStatus}
                  />
                </span>
                <span className="flex min-w-0 items-center gap-1.5" data-tauri-drag-region="deep">
                  <span className="truncate text-sm text-muted-foreground" data-tauri-drag-region="deep">{memberDetails.description}</span>
                  <TooltipButton aria-label={input.messages.chat.copyMessage} onClick={() => void copyDescription()} size="icon-xs" tooltip={input.messages.chat.copyMessage} type="button" variant="ghost">
                    <SleiIcon className="size-3.5" name="copy" />
                  </TooltipButton>
                </span>
              </span>
            )}
            actions={canMessage ? (
              <>
                <Button onClick={() => input.onMessage?.(selectedMember.id)} type="button">
                  <SleiIcon name="chat" />
                  {input.messages.members.message}
                </Button>
                {canDelete ? (
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button
                        disabled={deleting}
                        type="button"
                        variant="destructive"
                      >
                        <SleiIcon name="delete" />
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
              </>
            ) : null}
          />
        </div>
        {deleteError ? (
          <Alert className="mt-4" variant="destructive">
            <AlertDescription>{deleteError}</AlertDescription>
          </Alert>
        ) : null}
      </div>

      <Tabs className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)] gap-0" value={activeTab} onValueChange={(value) => setActiveTab(value as MemberTab)}>
        <div className="border-b px-4 py-2" data-testid="slei-member-detail-tabs">
          <TabsList aria-label={input.messages.members.memberConfig} variant="line">
            <TabsTrigger value="profile">{input.messages.members.profile}</TabsTrigger>
            <TabsTrigger value="workspace">{input.messages.members.workspace}</TabsTrigger>
            <TabsTrigger value="capabilities">{input.messages.members.capabilities}</TabsTrigger>
            <TabsTrigger value="permissions">{input.messages.members.permissions}</TabsTrigger>
            <TabsTrigger value="activity">{input.messages.members.activity}</TabsTrigger>
          </TabsList>
        </div>

        <ScrollArea className="min-h-0">
          <div className="grid gap-4 p-6">
            <TabsContent forceMount value="profile" className="grid gap-4 data-[state=inactive]:hidden">
              <SoftPanel className="grid gap-4">
                <h2 className="text-base font-semibold">{input.messages.members.profile}</h2>
                <div className="grid gap-4 md:grid-cols-2">
                  <EditableDetailField
                    ariaLabel={input.messages.members.editDisplayName}
                    error={fieldError.name}
                    label={input.messages.members.displayName}
                    messages={input.messages}
                    onSave={(value) => updateMemberDetail("name", value)}
                    saving={effectiveSavingField === "name"}
                    sectionClassName="grid gap-2"
                    value={memberDetails.name}
                  />
                  <ControlledFieldAlert message={input.memberFieldErrors?.name} />
                  <EditableDetailField
                    allowEmpty
                    ariaLabel={input.messages.members.editDescription}
                    error={fieldError.description}
                    label={input.messages.members.description}
                    messages={input.messages}
                    multiline
                    onSave={(value) => updateMemberDetail("description", value)}
                    saving={effectiveSavingField === "description"}
                    sectionClassName="grid gap-2"
                    value={memberDetails.description}
                  />
                  <ControlledFieldAlert message={input.memberFieldErrors?.description} />
                </div>
                <Separator />
                <h2 className="text-base font-semibold">{input.messages.members.info}</h2>
                <div className="grid gap-3 md:grid-cols-3">
                  <InfoItem blockId="computer" icon="cpu" label={input.messages.members.computer}>
                    <span>{selectedNode?.name ?? selectedMember.computer}</span>
                    <span className="inline-flex items-center gap-1 text-muted-foreground">
                      <StatusBadge label={nodeStatus} status={nodeDotStatus} />
                      daemon {selectedNode?.daemonVersion ?? "v0.54.1"}
                    </span>
                  </InfoItem>
                  <InfoItem blockId="created" icon="calendar" label={input.messages.members.created}>
                    {formatMemberCreatedDate(selectedMember.created)}
                  </InfoItem>
                  <InfoItem blockId="creator" icon="user" label={input.messages.members.creator}>
                    {selectedMember.creator}
                  </InfoItem>
                </div>
              </SoftPanel>

              <SoftPanel className="grid gap-4">
                <div className="flex min-w-0 flex-wrap items-center justify-between gap-3">
                  <h2 className="text-base font-semibold">{input.messages.members.runtimeConfig}</h2>
                  <StatusBadge
                    label={input.messages.status.runtime[selectedMember.runtimeStatus]}
                    status={selectedMember.runtimeStatus}
                  />
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <EditableDetailField
                    ariaLabel={input.messages.members.editRuntime}
                    error={fieldError.runtime}
                    label="Runtime"
                    messages={input.messages}
                    onSave={(value) => updateMemberDetail("runtime", value)}
                    readBadgeVariant="outline"
                    saving={effectiveSavingField === "runtime"}
                    sectionClassName="grid gap-2"
                    value={memberDetails.runtime}
                  />
                  <ControlledFieldAlert message={input.memberFieldErrors?.runtime} />
                  <EditableDetailField
                    ariaLabel={input.messages.members.editModel}
                    error={fieldError.model}
                    label={input.messages.members.model}
                    messages={input.messages}
                    onSave={(value) => updateMemberDetail("model", value)}
                    readBadgeVariant="outline"
                    saving={effectiveSavingField === "model"}
                    sectionClassName="grid gap-2"
                    value={memberDetails.model}
                  />
                  <ControlledFieldAlert message={input.memberFieldErrors?.model} />
                </div>
              </SoftPanel>
            </TabsContent>

            <TabsContent forceMount value="workspace" className="grid gap-4 data-[state=inactive]:hidden">
              <SoftPanel className="grid min-h-[28rem] overflow-hidden p-0 md:grid-cols-[16rem_minmax(0,1fr)]" aria-label={input.messages.members.workspace}>
                <aside className="grid min-h-0 overflow-hidden border-b bg-muted/20 md:border-b-0 md:border-r">
                  <ScrollArea className="min-h-0">
                    <div className="grid gap-1 p-2">
                      {workspaceRows.map(({ depth, entry }) => {
                        const expanded = expandedWorkspaceDirectories.has(entry.relativePath);
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
                              <SleiIcon className="size-3 text-muted-foreground" name={expanded ? "chevronDown" : "chevronRight"} />
                            ) : (
                              <span className="size-3 shrink-0" />
                            )}
                            <SleiIcon className="size-4" name={entry.kind === "directory" ? "folderOpen" : "file"} />
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
                      <SleiIcon name="externalLink" />
                      {input.messages.members.openInFileManager}
                    </Button>
                  </header>
                  <ScrollArea className="min-h-0">
                    <pre className="min-h-full whitespace-pre-wrap break-words p-4 font-mono text-xs leading-6 text-foreground">{activeWorkspaceFile?.content}</pre>
                  </ScrollArea>
                </article>
              </SoftPanel>
              {workspaceOpenError ? (
                <Alert variant="destructive">
                  <AlertDescription>{workspaceOpenError}</AlertDescription>
                </Alert>
              ) : null}
            </TabsContent>

            <TabsContent forceMount value="capabilities" className="grid gap-4 data-[state=inactive]:hidden">
              <SoftPanel className="grid gap-4">
                <h2 className="text-base font-semibold">{input.messages.members.skills}</h2>
                {memberSkills.length ? (
                  <div className="grid gap-2" role="list">
                    {memberSkills.map((skill) => (
                      <div className="grid gap-1 rounded-lg border bg-muted/20 p-3" key={skill.id} role="listitem">
                        <div className="flex min-w-0 items-center gap-2 text-sm font-medium">
                          <SleiIcon className="size-3 text-muted-foreground opacity-60" name="sparkles" />
                          <span className="truncate">{skill.name}</span>
                        </div>
                        {skill.trigger ? (
                          <p className="break-words text-xs text-muted-foreground">{skill.trigger}</p>
                        ) : null}
                      </div>
                    ))}
                  </div>
                ) : (
                  <InlineEmpty
                    description={input.messages.members.noSkillsDescription}
                    title={input.messages.members.noSkills}
                  />
                )}
              </SoftPanel>
            </TabsContent>

            <TabsContent forceMount value="permissions" className="grid gap-4 data-[state=inactive]:hidden">
              <SoftPanel className="grid gap-4">
                <div className="grid gap-1">
                  <h2 className="text-base font-semibold">{input.messages.members.capabilities}</h2>
                  <p className="text-sm text-muted-foreground">{input.messages.members.readOnly}</p>
                </div>
                {selectedMember.capabilities.length ? (
                  <div className="flex flex-wrap gap-2">
                    {selectedMember.capabilities.map((capability) => (
                      <StatusBadge key={capability} label={capability} status="info" />
                    ))}
                  </div>
                ) : (
                  <InlineEmpty
                    description={input.messages.members.capabilityScanUnavailable}
                    title={input.messages.members.noCapabilities}
                  />
                )}
              </SoftPanel>

              <SoftPanel className="grid gap-4">
                <div className="grid gap-1">
                  <h2 className="text-base font-semibold">{input.messages.members.workspacePermission}</h2>
                  <p className="text-sm text-muted-foreground">{input.messages.members.readOnly}</p>
                </div>
                {selectedMember.permissions.length ? (
                  <div className="flex flex-wrap gap-2">
                    {selectedMember.permissions.map((permission) => (
                      <StatusBadge key={permission} label={permission} status="approval" />
                    ))}
                  </div>
                ) : (
                  <InlineEmpty
                    description={input.messages.members.noWorkspacePermissions}
                    title={input.messages.members.workspacePermission}
                  />
                )}
              </SoftPanel>
            </TabsContent>

            <TabsContent forceMount value="activity" className="grid gap-2 data-[state=inactive]:hidden">
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
                <div aria-label={input.messages.members.activity} className="grid gap-3" role="list">
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
    input.log.severity,
    input.log.eventKind,
    activityResultLabel(input.log, input.messages),
    input.log.channelId ? channelActivityLabel(input.log.channelId) : undefined,
  ].filter((item): item is string => Boolean(item));
  return (
    <article className="grid gap-2 rounded-lg border bg-muted/20 p-3" data-activity-log-row={input.log.id} role="listitem">
      <div className="grid gap-1 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start">
        <div className="grid min-w-0 gap-1">
          <p className="break-words text-xs font-medium text-muted-foreground" data-activity-log-line="meta">
            {meta.join(" | ")}
          </p>
          <p className="break-words text-sm font-medium" data-activity-log-line="summary">{input.log.summary}</p>
        </div>
        <time className="text-xs text-muted-foreground sm:justify-self-end" data-activity-log-line="time" dateTime={input.log.createdAt}>
          {formatActivityLogTime(input.log.createdAt)}
        </time>
      </div>
      {input.log.payloadPreview ? (
        <div className="grid gap-2">
          <Button
            className="h-auto w-fit justify-start px-0 py-1 text-muted-foreground hover:bg-transparent hover:text-foreground"
            data-activity-log-payload-toggle=""
            onClick={input.onTogglePayload}
            type="button"
            variant="ghost"
          >
            <SleiIcon className="size-4" name={input.expanded ? "chevronDown" : "chevronRight"} />
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

function activityResultLabel(log: AgentActivityLogView, messages: DesktopMessages) {
  if (typeof log.ok === "boolean") return log.ok ? messages.members.activityOk : messages.members.activityFailed;
  if (log.state && log.state !== log.eventKind) return log.state;
  return undefined;
}

function channelActivityLabel(channelId: string) {
  return channelId.startsWith("#") ? channelId : `#${channelId}`;
}

function formatActivityLogTime(value: string) {
  return formatLocalRecordDateTime(value);
}

function memberDetailErrorMessage(error: unknown) {
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

function InlineEmpty(input: { description: string; title: string }) {
  return (
    <Empty
      description={input.description}
      framed={false}
      size="sm"
      title={input.title}
      variant="nodata"
    />
  );
}

function InfoItem(input: {
  blockId?: string;
  children: ReactNode;
  icon: SleiIconName;
  label: string;
}) {
  return (
    <DetailBlock data-member-detail-block={input.blockId}>
      <div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        <SleiIcon className="size-3.5" name={input.icon} />
        {input.label}
      </div>
      <div className="grid gap-1 text-sm">{input.children}</div>
    </DetailBlock>
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
