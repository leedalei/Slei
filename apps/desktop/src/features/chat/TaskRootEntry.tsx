import { Bookmark, Copy, MessageSquare } from "lucide-react";

import type { DesktopMessages } from "../../i18n";
import type { SleiMessage, SleiTask } from "../../app/types";
import { MemberAvatar, type MemberAvatarIdentity } from "../../components";
import { Button } from "../../components/ui/button";
import { cn } from "../../lib/utils";
import { MarkdownMessage } from "./MarkdownMessage";

const STATUS_CLASS: Record<SleiTask["status"], string> = {
  pending_assignment: "text-amber-700 dark:text-amber-300",
  in_progress: "text-blue-700 dark:text-blue-300",
  in_review: "text-violet-700 dark:text-violet-300",
  done: "text-green-700 dark:text-green-300",
};

const STATUS_DOT_CLASS: Record<SleiTask["status"], string> = {
  pending_assignment: "bg-amber-500",
  in_progress: "bg-blue-500",
  in_review: "bg-violet-500",
  done: "bg-green-500",
};

export function TaskRootEntry(input: {
  copyLabel?: string;
  messages: DesktopMessages;
  onOpen: () => void;
  onCopy?: () => Promise<void> | void;
  onSaveToggle?: () => Promise<void> | void;
  saved?: boolean;
  saveLabel?: string;
  sourceMessage?: SleiMessage;
  task: SleiTask;
  avatarIdentity?: MemberAvatarIdentity;
  roleDescription?: string;
  timestamp?: string;
}) {
  const replyCount = input.task.replyCount ?? input.task.replies?.length ?? 0;
  const replyCountLabel = input.messages.tasks.replyCountButton(replyCount);
  const openLabel = `${input.messages.tasks.commentThread}: ${input.task.title}, ${replyCountLabel}`;
  const body = input.sourceMessage?.body
    ?? input.task.replies?.find((reply) => reply.id.startsWith("root-") || reply.id.startsWith("root_"))?.body
    ?? input.task.replies?.[0]?.body
    ?? input.task.attention;
  const hasSourceMessage = Boolean(input.sourceMessage);
  const copyLabel = input.copyLabel ?? input.messages.chat.copyMessage;
  const saveLabel = input.saveLabel ?? (input.saved ? input.messages.chat.unsaveMessage : input.messages.chat.saveMessage);
  const timestamp = input.timestamp ?? input.sourceMessage?.time ?? "";
  const author = input.sourceMessage?.author ?? input.task.owner;
  const handle = input.sourceMessage?.handle;
  const avatarIdentity = input.avatarIdentity ?? {
    id: handle ?? author,
    name: author,
    handle: handle ?? author,
    avatar: input.sourceMessage?.avatar ?? author.slice(0, 2),
  };
  return (
    <article
      className="group relative grid grid-cols-[auto_minmax(0,1fr)] gap-3 rounded-lg px-2 py-2 text-sm transition-colors hover:bg-muted/20"
      data-source-message-id={input.sourceMessage?.id}
      data-task-root-entry={input.task.id}
    >
      <MemberAvatar identity={avatarIdentity} />
      <div className="min-w-0">
        <div className="flex min-w-0 items-center justify-between gap-2">
          <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden whitespace-nowrap text-xs text-muted-foreground">
            <strong className="shrink-0 text-sm text-foreground">{author}</strong>
            {handle ? <span className="shrink-0">{handle}</span> : null}
            <span aria-hidden="true">｜</span>
            <span className="min-w-0 flex-1 truncate">{input.roleDescription ?? input.task.title}</span>
          </div>
          <div className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground" data-task-root-entry-actions>
            <Button
              aria-label={openLabel}
              className="h-6 shrink-0 gap-1 rounded-md px-1.5 text-[11px]"
              data-task-root-entry-replies
              onClick={input.onOpen}
              type="button"
              variant="ghost"
            >
              <MessageSquare aria-hidden="true" className="size-3" />
              {replyCountLabel}
            </Button>
            <span aria-hidden="true">｜</span>
            <span className={cn("inline-flex items-center gap-1 whitespace-nowrap font-medium", STATUS_CLASS[input.task.status])} data-task-root-entry-status>
              <span className={cn("size-2 rounded-full", STATUS_DOT_CLASS[input.task.status])} data-task-root-entry-status-dot />
              {input.messages.tasks.status[input.task.status]}
            </span>
            <span aria-hidden="true">｜</span>
            <Button aria-label={copyLabel} onClick={() => void input.onCopy?.()} size="icon-xs" title={copyLabel} type="button" variant="ghost">
              <Copy aria-hidden="true" size={14} />
            </Button>
            <Button aria-label={saveLabel} aria-pressed={input.saved ? "true" : "false"} onClick={() => void input.onSaveToggle?.()} size="icon-xs" title={saveLabel} type="button" variant="ghost">
              <Bookmark aria-hidden="true" size={14} />
            </Button>
            {timestamp ? (
              <>
                <span aria-hidden="true">｜</span>
                <time className="whitespace-nowrap tabular-nums" dateTime={timestamp}>{timestamp}</time>
              </>
            ) : null}
          </div>
        </div>
        <MarkdownMessage markdown={body ?? input.task.title} />
        {hasSourceMessage ? null : (
          <div className="flex min-w-0 items-end gap-3">
            <span className="min-w-0 truncate text-xs text-muted-foreground">
              {input.task.title !== body ? input.task.title : input.task.owner}
            </span>
          </div>
        )}
      </div>
    </article>
  );
}
