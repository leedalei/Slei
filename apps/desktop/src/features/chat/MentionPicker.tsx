import type { DesktopMessages } from "../../i18n";
import type { SleiMember } from "../../app/types";
import { MemberAvatar, StatusDot } from "../../components";
import { Button } from "../../components/ui/button";
import { Card, CardContent } from "../../components/ui/card";
import { ScrollArea } from "../../components/ui/scroll-area";
import { cn } from "../../lib/utils";

export function MentionPicker({
  messages,
  members,
  onSelect,
  optionRef,
  selectedIndex,
}: {
  messages: DesktopMessages;
  members: SleiMember[];
  onSelect: (index: number) => void;
  optionRef?: (index: number, node: HTMLButtonElement | null) => void;
  selectedIndex: number;
}) {
  if (members.length === 0) return null;

  return (
    <Card aria-label={messages.chat.chooseMentionMember} className="max-h-[12.5rem] w-full max-w-full gap-2 overflow-hidden py-2" data-testid="slei-mention-panel" size="sm">
      <CardContent className="grid min-h-0 gap-1 px-2">
        <ScrollArea className="max-h-[10.5rem] min-h-0 pr-2">
          <div className="grid min-w-0 gap-1">
            {members.map((member, index) => (
              <Button
                aria-current={index === selectedIndex ? "true" : undefined}
                className={cn("h-auto min-h-12 w-full min-w-0 max-w-full overflow-hidden justify-start gap-2 px-2 py-2 text-left", index === selectedIndex && "bg-accent text-accent-foreground")}
                data-mention-option-index={index}
                key={member.id}
                onClick={() => onSelect(index)}
                ref={(node) => optionRef?.(index, node)}
                type="button"
                variant="ghost"
              >
                <MemberAvatar identity={member} />
                <span className="grid min-w-0 flex-1 gap-0.5">
                  <span className="flex min-w-0 items-center gap-2">
                    <strong className="truncate text-sm">{member.name}</strong>
                    <StatusDot status={member.runtimeStatus} />
                  </span>
                  <small className="block truncate text-xs font-normal text-muted-foreground">{member.role}</small>
                </span>
                <span className="max-w-[35%] truncate text-xs font-normal text-muted-foreground" title={member.handle}>{member.handle}</span>
              </Button>
            ))}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}
