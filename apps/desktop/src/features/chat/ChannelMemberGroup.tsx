import { useEffect, useRef, useState } from "react";

import type { DesktopMessages } from "../../i18n";
import type { SleiMember } from "../../app/types";
import { channelReadinessLabel } from "../../app/model";
import { Empty, MemberAvatar, SelectableCard, SleiIcon } from "../../components";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "../../components/ui/alert-dialog";
import { Button } from "../../components/ui/button";
import { Checkbox } from "../../components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "../../components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "../../components/ui/popover";
import { ScrollArea } from "../../components/ui/scroll-area";
import { Tooltip, TooltipContent, TooltipTrigger } from "../../components/ui/tooltip";
import { cn } from "../../lib/utils";

type ChannelMemberGroupProps = {
  availableMembers: SleiMember[];
  channelId: string;
  members: SleiMember[];
  messages: DesktopMessages;
  onAdd?: (agentId: string) => Promise<void> | void;
  onRemove?: (agentId: string) => Promise<void> | void;
};

const MAX_VISIBLE_CHANNEL_MEMBER_AVATARS = 5;

export function ChannelMemberGroup(input: ChannelMemberGroupProps) {
  const [mutatingMemberId, setMutatingMemberId] = useState<string | undefined>(undefined);
  const [confirmingRemoveId, setConfirmingRemoveId] = useState<string | undefined>(undefined);
  const [activeMemberId, setActiveMemberId] = useState<string | undefined>(undefined);
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [selectedAddIds, setSelectedAddIds] = useState<string[]>([]);
  const [addingSelected, setAddingSelected] = useState(false);
  const availableAddMemberIds = input.availableMembers.map((member) => member.id).join("|");
  const visibleMembers = input.members.slice(0, MAX_VISIBLE_CHANNEL_MEMBER_AVATARS);
  const overflowMemberCount = input.members.length - visibleMembers.length;

  useEffect(() => {
    const availableIds = new Set(input.availableMembers.map((member) => member.id));
    setSelectedAddIds((current) => {
      const next = current.filter((memberId) => availableIds.has(memberId));
      return next.length === current.length ? current : next;
    });
  }, [availableAddMemberIds, input.availableMembers]);

  function closeAddDialog() {
    setAddDialogOpen(false);
    setSelectedAddIds([]);
  }

  function toggleSelectedAddMember(memberId: string) {
    if (addingSelected) return;
    setSelectedAddIds((current) =>
      current.includes(memberId)
        ? current.filter((selectedId) => selectedId !== memberId)
        : [...current, memberId],
    );
  }

  async function addSelectedMembers() {
    if (selectedAddIds.length === 0) return;
    const selectedIds = input.availableMembers
      .map((member) => member.id)
      .filter((memberId) => selectedAddIds.includes(memberId));
    setAddingSelected(true);
    try {
      for (const memberId of selectedIds) {
        await input.onAdd?.(memberId);
      }
      closeAddDialog();
    } catch {
      // Keep the dialog and selections intact so callers can surface the failure.
    } finally {
      setAddingSelected(false);
    }
  }

  async function mutate(memberId: string, action: "remove") {
    setMutatingMemberId(memberId);
    try {
      if (action === "remove") {
        await input.onRemove?.(memberId);
        setConfirmingRemoveId(undefined);
        setActiveMemberId(undefined);
      }
    } catch {
      // Keep the popover and confirmation open when the daemon rejects the mutation.
    } finally {
      setMutatingMemberId(undefined);
    }
  }

  return (
    <div aria-label={input.messages.chat.channelMembers} className="slei-channel-member-group" data-testid="slei-channel-member-group">
      <div className="flex items-center">
        {visibleMembers.map((member, index) => (
          <ChannelMemberAvatar
            channelId={input.channelId}
            key={member.id}
            member={member}
            messages={input.messages}
            mutating={mutatingMemberId === member.id}
            offset={index > 0}
            onOpenChange={(open) => setActiveMemberId(open ? member.id : undefined)}
            open={activeMemberId === member.id || confirmingRemoveId === member.id}
            onRemove={() => void mutate(member.id, "remove")}
            confirmingRemoveId={confirmingRemoveId}
            setConfirmingRemoveId={setConfirmingRemoveId}
          />
        ))}
        {overflowMemberCount > 0 ? (
          <span
            aria-label={`${overflowMemberCount} ${input.messages.chat.channelMembers}`}
            className={cn("slei-channel-member-overflow", visibleMembers.length > 0 && "-ml-2")}
            data-testid="slei-channel-member-overflow-count"
          >
            +{overflowMemberCount}
          </span>
        ) : null}
        <Dialog open={addDialogOpen} onOpenChange={(open) => {
          setAddDialogOpen(open);
          if (!open) setSelectedAddIds([]);
        }}>
          <Tooltip>
            <TooltipTrigger asChild>
              <DialogTrigger asChild>
                <Button
                  aria-label={input.messages.chat.addChannelMember}
                  className={cn("slei-channel-member-add-button", input.members.length > 0 && "-ml-2")}
                  data-testid="slei-channel-member-add-trigger"
                  size="icon-sm"
                  type="button"
                  variant="outline"
                >
                  <SleiIcon name="plus" size={16} />
                </Button>
              </DialogTrigger>
            </TooltipTrigger>
            <TooltipContent>{input.messages.chat.addChannelMember}</TooltipContent>
          </Tooltip>
          <DialogContent className="w-[min(42rem,calc(100vw-2rem))] sm:max-w-2xl" closeLabel={input.messages.common.cancel} data-testid="slei-channel-member-add-dialog">
            <DialogHeader>
              <DialogTitle>{input.messages.chat.addChannelMember}</DialogTitle>
              <DialogDescription>{input.messages.chat.addChannelMemberDescription}</DialogDescription>
            </DialogHeader>
            <div className="grid min-h-0 gap-3 sm:grid-cols-[minmax(0,1fr)_13rem]">
              <ScrollArea className="max-h-[22rem] min-h-0 rounded-lg border bg-background">
                <div aria-multiselectable="true" className="grid gap-1 p-2" role="listbox">
                  {input.availableMembers.length > 0 ? (
                    input.availableMembers.map((member) => {
                      const selected = selectedAddIds.includes(member.id);
                      return (
                        <SelectableCard
                          aria-selected={selected ? "true" : "false"}
                          className="grid cursor-pointer grid-cols-[auto_minmax(0,1fr)] items-center gap-2 rounded-md px-2 py-2 focus-visible:outline-none"
                          data-testid="slei-channel-member-add-candidate"
                          key={member.id}
                          onClick={() => toggleSelectedAddMember(member.id)}
                          onKeyDown={(event) => {
                            if (event.key === "Enter" || event.key === " ") {
                              event.preventDefault();
                              toggleSelectedAddMember(member.id);
                            }
                          }}
                          role="option"
                          selected={selected}
                          tabIndex={0}
                        >
                          <Checkbox
                            aria-label={member.name}
                            checked={selected}
                            data-testid="slei-channel-member-add-candidate-checkbox"
                            disabled={addingSelected}
                            onCheckedChange={() => toggleSelectedAddMember(member.id)}
                            onClick={(event) => event.stopPropagation()}
                            onKeyDown={(event) => {
                              if (event.key === "Enter" || event.key === " ") {
                                event.preventDefault();
                                event.stopPropagation();
                                toggleSelectedAddMember(member.id);
                              }
                            }}
                          />
                          <span className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] items-center gap-2 overflow-hidden text-left">
                            <MemberAvatar identity={member} />
                            <span className="grid min-w-0 gap-0.5 overflow-hidden">
                              <span className="flex min-w-0 items-baseline gap-1.5">
                                <strong className="truncate text-sm text-foreground">{member.name}</strong>
                                <small className="shrink-0 text-xs font-normal text-muted-foreground">{member.handle}</small>
                              </span>
                              <small className="block min-w-0 max-w-full overflow-hidden text-ellipsis whitespace-nowrap text-xs font-normal text-muted-foreground" data-testid="slei-channel-member-add-candidate-description">
                                {member.description}
                              </small>
                            </span>
                          </span>
                        </SelectableCard>
                      );
                    })
                  ) : (
                    <Empty framed={false} size="sm" title={input.messages.chat.noAvailableChannelMembers} variant="nodata" />
                  )}
                </div>
              </ScrollArea>
              <div className="grid min-h-40 content-start gap-2 rounded-lg border bg-muted/30 p-3">
                <strong className="text-sm">{input.messages.chat.selectedChannelMembers(selectedAddIds.length)}</strong>
                {selectedAddIds.length > 0 ? (
                  <div className="grid gap-1">
                    {input.availableMembers.filter((member) => selectedAddIds.includes(member.id)).map((member) => (
                      <span className="truncate text-sm text-muted-foreground" key={member.id}>{member.name} {member.handle}</span>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">{input.messages.chat.noSelectedChannelMembers}</p>
                )}
              </div>
            </div>
            <DialogFooter>
              <Button disabled={addingSelected} onClick={closeAddDialog} type="button" variant="outline">{input.messages.common.cancel}</Button>
              <Button data-testid="slei-channel-member-add-confirm" disabled={selectedAddIds.length === 0 || addingSelected} onClick={() => void addSelectedMembers()} type="button" variant="primary">
                {input.messages.chat.confirmAddChannelMembers(selectedAddIds.length)}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}

function ChannelMemberAvatar(input: {
  channelId: string;
  confirmingRemoveId: string | undefined;
  member: SleiMember;
  messages: DesktopMessages;
  mutating: boolean;
  offset: boolean;
  onOpenChange: (open: boolean) => void;
  onRemove: () => void;
  open: boolean;
  setConfirmingRemoveId: (memberId: string | undefined) => void;
}) {
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const readiness = input.member.channelReadiness?.[input.channelId];
  const readinessLabel = channelReadinessLabel(readiness, input.messages);
  const description = input.member.role || input.member.description || input.member.activity;
  const confirming = input.confirmingRemoveId === input.member.id;

  useEffect(() => () => {
    if (closeTimerRef.current !== undefined) {
      clearTimeout(closeTimerRef.current);
    }
  }, []);

  function clearScheduledClose() {
    if (closeTimerRef.current !== undefined) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = undefined;
    }
  }

  function openFromPointer() {
    clearScheduledClose();
    input.onOpenChange(true);
  }

  function closeAfterPointerLeave() {
    if (confirming) return;
    clearScheduledClose();
    closeTimerRef.current = setTimeout(() => {
      input.onOpenChange(false);
      closeTimerRef.current = undefined;
    }, 120);
  }

  return (
    <Popover open={input.open} onOpenChange={input.onOpenChange}>
      <PopoverTrigger asChild>
        <button
          aria-label={`${input.member.name} ${input.member.handle}`}
          className={cn("slei-channel-member-avatar-button", input.offset && "-ml-2")}
          data-testid="slei-channel-member-avatar-trigger"
          onFocus={() => input.onOpenChange(true)}
          onMouseEnter={openFromPointer}
          onMouseLeave={closeAfterPointerLeave}
          type="button"
        >
          <MemberAvatar identity={input.member} />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="w-72 p-3"
        data-testid="slei-channel-member-info-card"
        onMouseEnter={openFromPointer}
        onMouseLeave={closeAfterPointerLeave}
      >
        <div className="grid gap-3">
          <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-3">
            <MemberAvatar identity={input.member} />
            <div className="grid min-w-0 gap-0.5">
              <strong className="truncate text-sm text-foreground">{input.member.name}</strong>
              <span className="truncate text-xs text-muted-foreground">{input.member.handle}</span>
            </div>
          </div>
          {description ? <p className="text-sm leading-relaxed text-muted-foreground">{description}</p> : null}
          <div className="flex items-center justify-between gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-md border border-border/60 bg-muted/30 px-2 py-1 text-xs text-muted-foreground">
              <span aria-hidden="true" className={cn("size-1.5 rounded-full", readiness === "ready" ? "bg-emerald-500" : "bg-muted-foreground/50")} />
              {readinessLabel}
            </span>
            <AlertDialog
              open={confirming}
              onOpenChange={(open) => {
                input.setConfirmingRemoveId(open ? input.member.id : undefined);
                input.onOpenChange(open);
              }}
            >
              <AlertDialogTrigger asChild>
                <Button aria-label={input.messages.chat.removeChannelMember(input.member.name)} className="text-[14px] leading-5 text-destructive hover:bg-destructive/10 hover:text-destructive" disabled={input.mutating} size="sm" type="button" variant="ghost">
                  <SleiIcon name="delete" size={14} />
                  {input.messages.chat.removeChannelMemberAction}
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent data-testid="slei-channel-member-remove-dialog">
                <AlertDialogHeader>
                  <AlertDialogTitle>{input.messages.chat.removeChannelMember(input.member.name)}</AlertDialogTitle>
                  <AlertDialogDescription>{input.messages.chat.removeChannelMemberConfirm(input.member.name)}</AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel disabled={input.mutating}>{input.messages.common.cancel}</AlertDialogCancel>
                  <AlertDialogAction
                    data-testid="slei-channel-member-remove-confirm"
                    disabled={input.mutating}
                    onClick={(event) => {
                      event.preventDefault();
                      input.onRemove();
                    }}
                    variant="destructive"
                  >
                    {input.messages.common.delete}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
