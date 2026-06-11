import { useEffect, useRef, useState } from "react";
import { MessageSquare } from "lucide-react";

import type { DesktopMessages } from "../../i18n";
import type { SleiFixtures, SleiTask } from "../../app/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
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
  const lastActiveTaskId = useRef<string | undefined>(undefined);
  const selectedTask = data.tasks.find((task) => task.id === selectedTaskId);

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
      <header className="border-b px-6 py-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="grid gap-1" data-slot="workspace-titlebar" data-tauri-drag-region="deep">
            <h1 className="text-2xl font-semibold">{messages.tasks.title}</h1>
            <p className="max-w-2xl text-sm text-muted-foreground">{messages.tasks.description}</p>
          </div>
        </div>
      </header>

      <Tabs className="min-h-0 gap-0" value={view} onValueChange={(value) => setView(value as "board" | "list")}>
        <div className="border-b px-6 py-3">
          <TabsList aria-label={messages.tasks.title} variant="line">
            <TabsTrigger value="board">{messages.tasks.board}</TabsTrigger>
            <TabsTrigger value="list">{messages.tasks.list}</TabsTrigger>
          </TabsList>
        </div>

        <ScrollArea className="min-h-0">
          <TabsContent className="m-0 data-[state=inactive]:hidden" value="board">
            <div className="grid gap-4 p-6 xl:grid-cols-4">
              {columns.map((column) => {
                const columnTasks = data.tasks.filter((task) => task.status === column);
                return (
                  <section aria-label={taskStatusLabel(column, messages)} className="grid min-h-40 content-start gap-3 rounded-lg border bg-muted/20 p-3" key={column}>
                    <div className="flex items-center justify-between gap-2">
                      <h2 className="text-sm font-medium">{taskStatusLabel(column, messages)}</h2>
                      <Badge variant="outline">{columnTasks.length}</Badge>
                    </div>
                    {columnTasks.length ? columnTasks.map((task) => (
                      <TaskCard key={task.id} messages={messages} onSelect={() => openTask(task.id)} task={task} />
                    )) : (
                      <p className="rounded-lg border border-dashed bg-background/60 p-3 text-sm text-muted-foreground" role="status">
                        {taskStatusLabel(column, messages)} 0
                      </p>
                    )}
                  </section>
                );
              })}
            </div>
          </TabsContent>

          <TabsContent className="m-0 data-[state=inactive]:hidden" value="list">
            <div className="grid gap-3 p-6">
              {data.tasks.map((task) => (
                <TaskCard layout="row" key={task.id} messages={messages} onSelect={() => openTask(task.id)} task={task} />
              ))}
              {data.tasks.length === 0 ? (
                <p className="rounded-lg border border-dashed bg-muted/30 p-4 text-sm text-muted-foreground" role="status">
                  {messages.tasks.list} 0
                </p>
              ) : null}
            </div>
          </TabsContent>
        </ScrollArea>
      </Tabs>

      <TaskThreadDrawer
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

function taskStatusLabel(status: SleiTask["status"], messages: DesktopMessages) {
  return messages.tasks.status[status];
}

function TaskCard(input: {
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
        <CardDescription>{input.task.owner}</CardDescription>
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
