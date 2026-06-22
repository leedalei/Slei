import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Hash, Kanban, List as ListIcon, MessageSquare, UserRound } from "lucide-react";

import type { DesktopMessages } from "../../i18n";
import type { SleiFixtures, SleiTask } from "../../app/types";
import { Empty } from "../../components";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
                icon={<Hash aria-hidden="true" className="size-3.5" />}
                label={messages.tasks.channelFilter}
                onChange={setChannelFilter}
                options={[
                  { label: messages.tasks.allChannels, value: "all" },
                  ...data.channels.map((channel) => ({ label: `#${channel.name}`, value: channel.id })),
                ]}
                value={channelFilter}
              />
              <TaskFilterSelect
                icon={<UserRound aria-hidden="true" className="size-3.5" />}
                label={messages.tasks.assigneeFilter}
                onChange={setAssigneeFilter}
                options={[
                  { label: messages.tasks.allAssignees, value: "all" },
                  ...data.members.map((member) => ({ label: member.name, value: member.id })),
                ]}
                value={assigneeFilter}
              />
            </div>
            <TabsList aria-label={messages.tasks.title} className="shrink-0" variant="line">
              <TabsTrigger onClick={() => setView("board")} value="board">
                <Kanban aria-hidden="true" className="size-3.5" />
                {messages.tasks.board}
              </TabsTrigger>
              <TabsTrigger onClick={() => setView("list")} value="list">
                <ListIcon aria-hidden="true" className="size-3.5" />
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
                  <section aria-label={taskStatusLabel(column, messages)} className="grid min-h-40 content-start gap-3 rounded-lg border bg-muted/20 p-3" key={column}>
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
                        description={messages.empty.defaultDescription.nodata}
                        framed={false}
                        size="sm"
                        title={taskStatusLabel(column, messages)}
                        variant="nodata"
                      />
                    )}
                  </section>
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
                  description={messages.empty.defaultDescription.nodata}
                  framed={false}
                  title={messages.tasks.list}
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
    <Card className={row ? "grid gap-0 sm:grid-cols-[1fr_auto]" : ""} size="sm">
      <CardHeader className={row ? "min-w-0" : ""}>
        <CardTitle className="break-words">{input.task.title}</CardTitle>
        <CardDescription className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
          <span className="inline-flex items-center gap-1">
            <Hash aria-hidden="true" className="size-3" />
            {input.messages.tasks.taskChannelLabel(input.channelName)}
          </span>
          <span className="inline-flex items-center gap-1">
            <UserRound aria-hidden="true" className="size-3" />
            {input.messages.tasks.taskAssigneeLabel(input.assigneeName)}
          </span>
        </CardDescription>
        <CardAction>
          <Button aria-label={input.messages.tasks.commentThread} onClick={input.onSelect} size="sm" type="button" variant="outline">
            <MessageSquare aria-hidden="true" className="size-3.5" />
            {replyCount}
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-wrap items-center gap-2">
        <Badge variant="outline">{input.task.id}</Badge>
        <TaskStatusBadge messages={input.messages} status={input.task.status} />
        {input.task.attention ? <Badge variant="destructive">{input.task.attention}</Badge> : null}
      </CardContent>
    </Card>
  );
}
