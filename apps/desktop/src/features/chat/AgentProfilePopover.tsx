import { useEffect, useRef, type ReactNode } from "react";

import type { DesktopMessages } from "../../i18n";
import type { SleiMember } from "../../app/types";
import { MemberAvatar } from "../../components";
import { getSleiStatusIndicatorClassName } from "../../components/StatusBadge";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "../../components/ui/popover";
import { cn } from "../../lib/utils";

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
          <div className="flex items-center justify-between gap-3" data-slot="agent-profile-header">
            <MemberAvatar identity={input.member} large />
            {input.action ? <div data-slot="agent-profile-header-action">{input.action}</div> : null}
          </div>
          <div className="flex min-w-0 items-center gap-2 overflow-hidden" data-slot="agent-profile-identity">
            <strong className="min-w-0 flex-1 truncate text-sm text-foreground">{input.member.name}</strong>
            <Badge className="min-w-0 max-w-[60%] shrink truncate" variant="secondary">{input.member.profession ?? input.member.role}</Badge>
          </div>
          <div className="flex min-w-0 items-center justify-between gap-2" data-slot="agent-profile-metadata">
            <span className="truncate text-xs text-muted-foreground">{input.member.handle}</span>
            <span className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-border/60 bg-muted/30 px-2 py-1 text-xs text-muted-foreground">
              <span aria-hidden="true" className={cn("size-1.5 rounded-full", getSleiStatusIndicatorClassName(input.member.runtimeStatus))} data-slot="agent-profile-status-dot" />
              {input.messages.status.runtime[input.member.runtimeStatus]}
            </span>
          </div>
          {input.member.description ? <p className="text-sm leading-relaxed text-muted-foreground" data-slot="agent-profile-description">{input.member.description}</p> : null}
          {canMessage ? (
            <Button
              aria-label={input.messages.members.message}
              className="w-full"
              data-testid={input.messageButtonTestId ?? "slei-agent-profile-message-button"}
              onClick={() => {
                input.onOpenChange(false);
                input.onMessage?.();
              }}
              type="button"
            >
              {input.messages.members.message}
            </Button>
          ) : null}
        </div>
      </PopoverContent>
    </Popover>
  );
}
