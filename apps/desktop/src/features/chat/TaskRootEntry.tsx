import type { DesktopMessages } from "../../i18n";
import type { SleiMessage, SleiTask } from "../../app/types";
import { MemberAvatar, SleiIcon, SleiIconSwap, TooltipButton, type MemberAvatarIdentity } from "../../components";
import { Button } from "../../components/ui/button";
import { Card } from "../../components/ui/card";
import { cn } from "../../lib/utils";
import { MarkdownMessage } from "./MarkdownMessage";

const CARD_FLAT_CLASS = "rounded-lg border-transparent bg-transparent text-card-foreground shadow-none backdrop-blur-none before:hidden after:hidden";
const TASK_ROOT_ACTION_BUTTON_CLASS = "size-6 [&_svg]:size-2.5";
const TASK_ROOT_ACTION_ICON_CLASS = "size-2.5";

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
  side?: "incoming" | "outgoing";
  timestamp?: string;
}) {
  const side = input.side ?? "incoming";
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
    <Card
      className={cn(
        CARD_FLAT_CLASS,
        "group relative grid gap-3 bg-transparent px-2 py-2 transition-colors duration-[2s]",
        side === "outgoing"
          ? "grid-cols-[minmax(0,42rem)_auto] justify-end justify-items-end"
          : "grid-cols-[auto_minmax(min(42rem,100%),1fr)] justify-start justify-items-start",
      )}
      data-message-side={side}
      data-task-root-entry={input.task.id}
      data-source-message-id={input.sourceMessage?.id}
    >
      {side === "incoming" ? <MemberAvatar identity={avatarIdentity} /> : null}
      <div className={cn("grid min-w-0 gap-1.5", side === "outgoing" ? "justify-items-end" : "justify-items-start")} data-slot="message-content">
        <div className={cn("flex w-full min-w-0 items-center gap-2", side === "outgoing" ? "max-w-[min(42rem,100%)] justify-end" : "max-w-full justify-between")}>
          <div className={cn("flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden whitespace-nowrap text-xs text-muted-foreground", side === "outgoing" && "justify-end text-right")}>
            <strong className="shrink-0 text-sm text-foreground">{author}</strong>
            {handle ? <span className="shrink-0">{handle}</span> : null}
            <span aria-hidden="true">｜</span>
            <span className="min-w-0 flex-1 truncate">{input.roleDescription ?? input.task.title}</span>
          </div>
          <div className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground" data-task-root-entry-actions>
            <Button
              aria-label={openLabel}
              className="h-6 shrink-0 gap-1 rounded-md px-1.5 text-[11px] [&_svg]:size-2.5"
              data-task-root-entry-replies
              onClick={input.onOpen}
              type="button"
              variant="ghost"
            >
              <SleiIcon className={TASK_ROOT_ACTION_ICON_CLASS} name="messageSquare" />
              {replyCountLabel}
            </Button>
            <span aria-hidden="true">｜</span>
            <span className={cn("inline-flex items-center gap-1 whitespace-nowrap font-medium", STATUS_CLASS[input.task.status])} data-task-root-entry-status>
              <span className={cn("size-2 rounded-full", STATUS_DOT_CLASS[input.task.status])} data-task-root-entry-status-dot />
              {input.messages.tasks.status[input.task.status]}
            </span>
            <span aria-hidden="true">｜</span>
            <TooltipButton aria-label={copyLabel} className={TASK_ROOT_ACTION_BUTTON_CLASS} onClick={() => void input.onCopy?.()} size="icon" tooltip={copyLabel} type="button" variant="ghost">
              <SleiIcon className={TASK_ROOT_ACTION_ICON_CLASS} name="copy" />
            </TooltipButton>
            <TooltipButton aria-label={saveLabel} aria-pressed={input.saved ? "true" : "false"} className={TASK_ROOT_ACTION_BUTTON_CLASS} onClick={() => void input.onSaveToggle?.()} size="icon" tooltip={saveLabel} type="button" variant="ghost">
              <SleiIconSwap active={Boolean(input.saved)} activeName="bookmark" className={TASK_ROOT_ACTION_ICON_CLASS} iconClassName={TASK_ROOT_ACTION_ICON_CLASS} inactiveName="bookmarkOutline" />
            </TooltipButton>
            {timestamp ? (
              <>
                <span aria-hidden="true">｜</span>
                <time className="whitespace-nowrap tabular-nums" dateTime={timestamp}>{timestamp}</time>
              </>
            ) : null}
          </div>
        </div>
        <div
          className={cn(
            "grid gap-2 rounded-2xl px-3.5 py-2.5",
            side === "outgoing"
              ? "w-fit max-w-[min(42rem,100%)] rounded-tr-sm bg-primary text-primary-foreground shadow-sm"
              : "w-full max-w-full rounded-tl-sm border border-border/70 bg-card text-card-foreground shadow-xs",
          )}
          data-slot="message-bubble"
        >
          <MarkdownMessage markdown={body ?? input.task.title} tone={side === "outgoing" ? "primary" : "card"} />
          {hasSourceMessage ? null : (
            <div className="flex min-w-0 items-end gap-3">
              <span className={cn("min-w-0 truncate text-xs", side === "outgoing" ? "text-primary-foreground/75" : "text-muted-foreground")}>
                {input.task.title !== body ? input.task.title : input.task.owner}
              </span>
            </div>
          )}
        </div>
      </div>
      {side === "outgoing" ? <MemberAvatar identity={avatarIdentity} /> : null}
    </Card>
  );
}
