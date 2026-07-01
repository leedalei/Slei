import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import type { DesktopMessages } from "../../i18n";
import type { SleiFixtures, SleiMember, SleiTask } from "../../app/types";
import { Empty, MemberAvatar, SelectableCard, SleiIcon, StatusBadge, type MemberAvatarIdentity } from "../../components";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TaskStatusBadge } from "./TaskStatusBadge";
import { TaskThreadDrawer } from "./TaskThreadDrawer";

const CARD_SURFACE_CLASS = "rounded-xl border-border/60 bg-card/45 text-card-foreground shadow-none backdrop-blur-none before:hidden after:hidden";
const CARD_LIST_ITEM_CLASS = "min-w-0 max-w-full overflow-hidden rounded-lg border-border/60 bg-card text-card-foreground shadow-none backdrop-blur-none before:hidden after:hidden transition-colors hover:bg-card";

export function TasksPage({
  activeTaskId,
  data,
  messages,
  onTaskReply,
  onTaskStatusChange,
  onTaskThreadClose,
  onTaskThreadOpen,
}: {
  activeTaskId?: string;
  data: SleiFixtures;
  messages: DesktopMessages;
  onTaskReply?: (taskId: string, body: string) => Promise<void> | void;
  onTaskStatusChange?: (taskId: string, status: SleiTask["status"]) => Promise<void> | void;
  onTaskThreadClose?: (taskId: string) => void;
  onTaskThreadOpen?: (taskId: string) => Promise<void> | void;
}) {
  const columns: SleiTask["status"][] = ["pending_assignment", "in_progress", "in_review", "done"];
  const [selectedTaskId, setSelectedTaskId] = useState(activeTaskId);
  const [view, setView] = useState<"board" | "list">("board");
  const [channelFilter, setChannelFilter] = useState("all");
  const [assigneeFilter, setAssigneeFilter] = useState("all");
  const lastActiveTaskId = useRef<string | undefined>(undefined);
  const selectedTask = data.tasks.find((task) => task.id === selectedTaskId);
  const channelsById = useMemo(() => new Map(data.channels.map((channel) => [channel.id, channel])), [data.channels]);
  const membersById = useMemo(() => new Map(data.members.map((member) => [member.id, member])), [data.members]);
  const filteredTasks = data.tasks.filter((task) => {
    if (channelFilter !== "all" && task.channelId !== channelFilter) return false;
    if (assigneeFilter !== "all" && task.assigneeId !== assigneeFilter) return false;
    return true;
  });

  useEffect(() => {
    if (activeTaskId && activeTaskId !== lastActiveTaskId.current) {
      setSelectedTaskId(activeTaskId);
      void Promise.resolve(onTaskThreadOpen?.(activeTaskId)).catch(() => undefined);
    }
    lastActiveTaskId.current = activeTaskId;
  }, [activeTaskId, onTaskThreadOpen]);

  function openTask(taskId: string) {
    setSelectedTaskId(taskId);
    void Promise.resolve(onTaskThreadOpen?.(taskId)).catch(() => undefined);
  }

  return (
    <section className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)] overflow-hidden bg-transparent">
      <Tabs className="min-h-0 gap-0" value={view} onValueChange={(value) => setView(value as "board" | "list")}>
        <header className="select-none border-b" data-testid="slei-tasks-header" data-tauri-drag-region="deep">
          <div className="flex flex-wrap items-start justify-between gap-4 px-6 py-5" data-tauri-drag-region="deep">
            <div className="grid gap-1" data-slot="workspace-titlebar" data-tauri-drag-region="deep">
              <h1 className="text-2xl font-semibold" data-tauri-drag-region="deep">{messages.tasks.title}</h1>
              <p className="max-w-2xl text-sm text-muted-foreground" data-tauri-drag-region="deep">{messages.tasks.channelTasksCount(filteredTasks.length)}</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 border-t px-6 py-3" data-tauri-drag-region="deep">
            <div className="flex flex-wrap items-center gap-2">
              <TaskFilterSelect
                icon={<SleiIcon className="size-3.5" name="hash" />}
                label={messages.tasks.channelFilter}
                onChange={setChannelFilter}
                options={[
                  { label: messages.tasks.allChannels, value: "all" },
                  ...data.channels.map((channel) => ({ label: `#${channel.name}`, value: channel.id })),
                ]}
                value={channelFilter}
              />
              <TaskFilterSelect
                icon={<SleiIcon className="size-3.5" name="user" />}
                label={messages.tasks.assigneeFilter}
                onChange={setAssigneeFilter}
                options={[
                  { label: messages.tasks.allAssignees, value: "all" },
                  ...data.members.map((member) => ({ label: member.name, value: member.id })),
                ]}
                value={assigneeFilter}
              />
            </div>
            <TabsList aria-label={messages.tasks.title} className="shrink-0" variant="soft">
              <TabsTrigger onClick={() => setView("board")} value="board">
                <SleiIcon className="size-3.5" name="kanban" />
                {messages.tasks.board}
              </TabsTrigger>
              <TabsTrigger onClick={() => setView("list")} value="list">
                <SleiIcon className="size-3.5" name="listDetails" />
                {messages.tasks.list}
              </TabsTrigger>
            </TabsList>
          </div>
        </header>

        <ScrollArea className="min-h-0">
          <TabsContent className="m-0 data-[state=inactive]:hidden" value="board">
            <div className="grid min-w-0 grid-cols-[repeat(4,minmax(17rem,1fr))] gap-4 overflow-x-auto p-6">
              {columns.map((column) => {
                const columnTasks = filteredTasks.filter((task) => task.status === column);
                return (
                  <Card aria-label={taskStatusLabel(column, messages)} className={`${CARD_SURFACE_CLASS} grid min-h-40 min-w-0 content-start gap-3 p-3`} key={column} role="region">
                    <div className="flex items-center justify-between gap-2">
                      <h2 className="text-sm font-medium">{taskStatusLabel(column, messages)}</h2>
                      {columnTasks.length > 0 ? <Badge variant="outline">{columnTasks.length}</Badge> : null}
                    </div>
                    {columnTasks.length ? columnTasks.map((task) => (
                      <TaskCard
                        assigneeIdentity={taskAssigneeIdentity(task, membersById)}
                        channelName={taskChannelName(task, channelsById, messages)}
                        key={task.id}
                        messages={messages}
                        onSelect={() => openTask(task.id)}
                        selected={selectedTaskId === task.id}
                        task={task}
                      />
                    )) : (
                      <Empty
                        framed={false}
                        size="sm"
                        title={messages.empty.defaultTitle.nodata}
                        variant="nodata"
                      />
                    )}
                  </Card>
                );
              })}
            </div>
          </TabsContent>

          <TabsContent className="m-0 data-[state=inactive]:hidden" value="list">
            <div className="grid gap-3 p-6">
              {filteredTasks.map((task) => (
                <TaskCard
                  assigneeIdentity={taskAssigneeIdentity(task, membersById)}
                  channelName={taskChannelName(task, channelsById, messages)}
                  layout="row"
                  key={task.id}
                  messages={messages}
                  onSelect={() => openTask(task.id)}
                  selected={selectedTaskId === task.id}
                  task={task}
                />
              ))}
              {filteredTasks.length === 0 ? (
                <Empty
                  framed={false}
                  title={messages.empty.defaultTitle.nodata}
                  variant="nodata"
                />
              ) : null}
            </div>
          </TabsContent>
        </ScrollArea>
      </Tabs>

      <TaskThreadDrawer
        mentionMembers={data.members}
        messages={messages}
        onClose={() => {
          if (selectedTaskId) onTaskThreadClose?.(selectedTaskId);
          setSelectedTaskId(undefined);
        }}
        onReply={onTaskReply}
        onStatusChange={onTaskStatusChange}
        open={Boolean(selectedTask)}
        task={selectedTask}
      />
    </section>
  );
}

function TaskFilterSelect(input: {
  icon: ReactNode;
  label: string;
  onChange: (value: string) => void;
  options: Array<{ label: string; value: string }>;
  value: string;
}) {
  const selectedLabel = input.options.find((option) => option.value === input.value)?.label ?? input.label;
  return (
    <Select value={input.value} onValueChange={input.onChange}>
      <SelectTrigger aria-label={input.label} className="w-56 min-w-0 max-w-full">
        {input.icon}
        <span data-slot="select-value" className="min-w-0 flex-1 truncate text-left">{selectedLabel}</span>
      </SelectTrigger>
      <SelectContent align="start" position="popper">
        {input.options.map((option) => (
          <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function taskStatusLabel(status: SleiTask["status"], messages: DesktopMessages) {
  return messages.tasks.status[status];
}

function taskChannelName(task: SleiTask, channelsById: Map<string, { name: string }>, messages: DesktopMessages) {
  if (!task.channelId) return messages.tasks.unknownChannel;
  return channelsById.get(task.channelId)?.name ?? task.channelId;
}

function taskAssigneeIdentity(task: SleiTask, membersById: Map<string, SleiMember>): MemberAvatarIdentity {
  const member = task.assigneeId ? membersById.get(task.assigneeId) : undefined;
  if (member) return member;
  const name = task.owner || task.assigneeId || "Agent";
  return {
    id: task.assigneeId ?? `task-owner-${name}`,
    name,
    handle: name.startsWith("@") ? name : `@${name.toLowerCase().replace(/\s+/g, "-")}`,
    avatar: name.slice(0, 2).toUpperCase(),
  };
}

function TaskCard(input: {
  assigneeIdentity: MemberAvatarIdentity;
  channelName: string;
  layout?: "card" | "row";
  messages: DesktopMessages;
  onSelect: () => void;
  selected?: boolean;
  task: SleiTask;
}) {
  const replyCount = input.task.replyCount ?? input.task.replies?.length ?? 0;
  const row = input.layout === "row";

  return (
    <SelectableCard
      selected={input.selected}
      data-task-id={input.task.id}
      className={row ? `${CARD_LIST_ITEM_CLASS} grid w-full gap-3 p-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start` : `${CARD_LIST_ITEM_CLASS} grid w-full gap-3 p-3`}
    >
      <div className="min-w-0">
        <h3 className="break-words text-sm font-semibold">{input.task.title}</h3>
        <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground" data-task-card-metadata>
          <span className="inline-flex min-w-0 max-w-full items-center truncate">{input.messages.tasks.taskChannelLabel(input.channelName)}</span>
        </p>
      </div>
      <Badge className="min-w-0 max-w-full shrink justify-self-start truncate" data-task-card-id variant="outline">{input.task.id}</Badge>
      <div className="flex min-w-0 max-w-full flex-wrap items-center gap-2">
        <TaskStatusBadge className="shrink-0" messages={input.messages} status={input.task.status} />
        <span
          className="inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-full border border-border/60 bg-background/70 py-0.5 pl-0.5 pr-2 text-xs font-medium text-muted-foreground [&_[data-slot=avatar]]:size-[18px]"
          data-task-card-assignee
        >
          <MemberAvatar identity={input.assigneeIdentity} />
          <span className="min-w-0 truncate">{input.assigneeIdentity.name}</span>
        </span>
        {input.task.attention ? <StatusBadge label={input.task.attention} status="warn" /> : null}
        <div className={row ? "shrink-0 sm:ml-auto" : "ml-auto shrink-0"}>
          <Button aria-label={input.messages.tasks.commentThread} onClick={input.onSelect} size="sm" type="button" variant="outline">
            <SleiIcon className="size-3.5" name="chat" />
            {replyCount}
          </Button>
        </div>
      </div>
    </SelectableCard>
  );
}
