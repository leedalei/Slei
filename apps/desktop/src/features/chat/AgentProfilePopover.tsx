import { useEffect, useRef, type ReactNode } from "react";

import type { DesktopMessages } from "../../i18n";
import type { SleiMember, SleiChannelMemberReadiness } from "../../app/types";
import { channelReadinessLabel } from "../../app/model";
import { MemberAvatar, SleiIcon } from "../../components";
import { AvatarBadge } from "../../components/ui/avatar";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "../../components/ui/popover";
import { cn } from "../../lib/utils";

export type AgentProfileStatus =
  | { kind: "runtime"; status: SleiMember["runtimeStatus"] }
  | { kind: "channel"; readiness: SleiChannelMemberReadiness | undefined; channelId: string };

export function AgentProfilePopover(input: {
  action?: ReactNode;
  align?: "start" | "center" | "end";
  cardTestId?: string;
  children?: ReactNode;
  member: SleiMember;
  messageButtonTestId?: string;
  messages: DesktopMessages;
  onMessage?: () => void;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  status: AgentProfileStatus;
  triggerClassName?: string;
  triggerTestId?: string;
}) {
  const canMessage = input.member.directMessageEnabled !== false && Boolean(input.onMessage);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!input.open) return undefined;
    function closeOnOutsidePointerDown(event: PointerEvent) {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (triggerRef.current?.contains(target) || contentRef.current?.contains(target)) return;
      input.onOpenChange(false);
    }
    document.addEventListener("pointerdown", closeOnOutsidePointerDown, true);
    return () => document.removeEventListener("pointerdown", closeOnOutsidePointerDown, true);
  }, [input]);

  return (
    <Popover open={input.open} onOpenChange={input.onOpenChange}>
      <PopoverTrigger asChild>
        <button
          ref={triggerRef}
          aria-label={`${input.member.name} ${input.member.handle}`}
          className={cn("relative inline-flex shrink-0 items-center justify-center rounded-full outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50", input.triggerClassName)}
          data-testid={input.triggerTestId ?? "slei-agent-profile-trigger"}
          type="button"
        >
          {input.children ?? <MemberAvatar identity={input.member} />}
        </button>
      </PopoverTrigger>
      <PopoverContent ref={contentRef} align={input.align ?? "end"} className="w-72 p-3" data-agent-profile-card="" data-testid={input.cardTestId ?? "slei-agent-profile-card"}>
        <div className="grid gap-3">
          <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-3">
            <MemberAvatar identity={input.member} large>
              {canMessage ? (
                <AvatarBadge asChild>
                  <button
                    aria-label={input.messages.members.message}
                    data-testid={input.messageButtonTestId ?? "slei-agent-profile-message-button"}
                    onClick={() => {
                      input.onOpenChange(false);
                      input.onMessage?.();
                    }}
                    type="button"
                  >
                    <SleiIcon name="messageCircleMore" />
                  </button>
                </AvatarBadge>
              ) : null}
            </MemberAvatar>
            <div className="grid min-w-0 gap-1">
              <strong className="truncate text-sm text-foreground">{input.member.name}</strong>
              <span className="truncate text-xs text-muted-foreground">{input.member.handle}</span>
              <Badge className="w-fit max-w-full truncate" variant="secondary">{input.member.profession ?? input.member.role}</Badge>
            </div>
          </div>
          {input.member.description ? <p className="text-sm leading-relaxed text-muted-foreground">{input.member.description}</p> : null}
          <div className="flex items-center justify-between gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-md border border-border/60 bg-muted/30 px-2 py-1 text-xs text-muted-foreground">
              <span aria-hidden="true" className={cn("size-1.5 rounded-full", statusDotClass(input.status))} />
              {statusLabel(input.status, input.messages)}
            </span>
            {input.action}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function statusLabel(status: AgentProfileStatus, messages: DesktopMessages) {
  if (status.kind === "channel") return channelReadinessLabel(status.readiness, messages);
  if (status.status === "busy") return "忙碌";
  return messages.status.runtime[status.status];
}

function statusDotClass(status: AgentProfileStatus) {
  if (status.kind === "channel") return status.readiness === "ready" ? "bg-emerald-500" : "bg-muted-foreground/50";
  if (status.status === "busy") return "bg-blue-500";
  if (status.status === "offline") return "bg-muted-foreground/50";
  return "bg-emerald-500";
}
