import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import type { DesktopMessages } from "../../i18n";
import type { SleiFixtures, SleiTask } from "../../app/types";
import { Empty, SleiIcon, SoftPanel, StatusBadge } from "../../components";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TaskStatusBadge } from "./TaskStatusBadge";
import { TaskThreadDrawer } from "./TaskThreadDrawer";

export function TasksPage({
  activeTaskId,
  data,
  messages,
  onTaskReply,
  onTaskStatusChange,
  onTaskThreadOpen,
}: {
  activeTaskId?: string;
  data: SleiFixtures;
  messages: DesktopMessages;
  onTaskReply?: (taskId: string, body: string) => Promise<void> | void;
  onTaskStatusChange?: (taskId: string, status: SleiTask["status"]) => Promise<void> | void;
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
    <section className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)] overflow-hidden bg-background">
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
                <SleiIcon className="size-3.5" name="tasks" />
                {messages.tasks.board}
              </TabsTrigger>
              <TabsTrigger onClick={() => setView("list")} value="list">
                <SleiIcon className="size-3.5" name="file" />
                {messages.tasks.list}
              </TabsTrigger>
            </TabsList>
          </div>
        </header>

        <ScrollArea className="min-h-0">
          <TabsContent className="m-0 data-[state=inactive]:hidden" value="board">
            <div className="grid gap-4 p-6 xl:grid-cols-4">
              {columns.map((column) => {
                const columnTasks = filteredTasks.filter((task) => task.status === column);
                return (
                  <SoftPanel aria-label={taskStatusLabel(column, messages)} className="grid min-h-40 content-start gap-3 p-3" key={column}>
                    <div className="flex items-center justify-between gap-2">
                      <h2 className="text-sm font-medium">{taskStatusLabel(column, messages)}</h2>
                      {columnTasks.length > 0 ? <Badge variant="outline">{columnTasks.length}</Badge> : null}
                    </div>
                    {columnTasks.length ? columnTasks.map((task) => (
                      <TaskCard
                        assigneeName={taskAssigneeName(task, membersById)}
                        channelName={taskChannelName(task, channelsById, messages)}
                        key={task.id}
                        messages={messages}
                        onSelect={() => openTask(task.id)}
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
                  </SoftPanel>
                );
              })}
            </div>
          </TabsContent>

          <TabsContent className="m-0 data-[state=inactive]:hidden" value="list">
            <div className="grid gap-3 p-6">
              {filteredTasks.map((task) => (
                <TaskCard
                  assigneeName={taskAssigneeName(task, membersById)}
                  channelName={taskChannelName(task, channelsById, messages)}
                  layout="row"
                  key={task.id}
                  messages={messages}
                  onSelect={() => openTask(task.id)}
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
        onClose={() => setSelectedTaskId(undefined)}
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
      <SelectTrigger aria-label={input.label} className="min-w-36">
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

function taskAssigneeName(task: SleiTask, membersById: Map<string, { name: string }>) {
  return (task.assigneeId ? membersById.get(task.assigneeId)?.name : undefined) ?? task.owner;
}

function TaskCard(input: {
  assigneeName: string;
  channelName: string;
  layout?: "card" | "row";
  messages: DesktopMessages;
  onSelect: () => void;
  task: SleiTask;
}) {
  const replyCount = input.task.replyCount ?? input.task.replies?.length ?? 0;
  const row = input.layout === "row";

  return (
    <SoftPanel className={row ? "grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start" : "grid gap-3"} variant="listItem">
      <div className={row ? "min-w-0" : ""}>
        <h3 className="break-words text-sm font-semibold">{input.task.title}</h3>
        <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <SleiIcon className="size-3" name="hash" />
            {input.messages.tasks.taskChannelLabel(input.channelName)}
          </span>
          <span className="inline-flex items-center gap-1">
            <SleiIcon className="size-3" name="user" />
            {input.messages.tasks.taskAssigneeLabel(input.assigneeName)}
          </span>
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline">{input.task.id}</Badge>
        <TaskStatusBadge messages={input.messages} status={input.task.status} />
        {input.task.attention ? <StatusBadge label={input.task.attention} status="warn" /> : null}
        <div className={row ? "sm:ml-auto" : "ml-auto"}>
          <Button aria-label={input.messages.tasks.commentThread} onClick={input.onSelect} size="sm" type="button" variant="outline">
            <SleiIcon className="size-3.5" name="chat" />
            {replyCount}
          </Button>
        </div>
      </div>
    </SoftPanel>
  );
}
