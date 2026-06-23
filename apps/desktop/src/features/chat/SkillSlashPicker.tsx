import type { DesktopMessages } from "../../i18n";
import type { SkillView } from "../../lib/daemon-bridge";
import { Button } from "../../components/ui/button";
import { Card, CardContent } from "../../components/ui/card";
import { ScrollArea } from "../../components/ui/scroll-area";
import { cn } from "../../lib/utils";

export function SkillSlashPicker({
  messages,
  onSelect,
  optionRef,
  selectedIndex,
  skills,
}: {
  messages: DesktopMessages;
  onSelect: (index: number) => void;
  optionRef?: (index: number, node: HTMLButtonElement | null) => void;
  selectedIndex: number;
  skills: SkillView[];
}) {
  if (skills.length === 0) return null;

  return (
    <Card aria-label={messages.chat.chooseSkill} className="max-h-[12.5rem] w-full max-w-full gap-2 overflow-hidden py-2" data-testid="slei-skill-slash-panel" size="sm">
      <CardContent className="grid min-h-0 gap-1 px-2">
        <ScrollArea className="max-h-[10.5rem] min-h-0 pr-2">
          <div className="grid min-w-0 gap-1">
            {skills.map((skill, index) => (
              <Button
                aria-current={index === selectedIndex ? "true" : undefined}
                className={cn("h-auto min-h-12 w-full min-w-0 max-w-full overflow-hidden justify-start gap-2 px-2 py-2 text-left", index === selectedIndex && "bg-accent text-accent-foreground")}
                data-skill-slash-option-index={index}
                key={skill.id}
                onClick={() => onSelect(index)}
                ref={(node) => optionRef?.(index, node)}
                type="button"
                variant="ghost"
              >
                <span className="grid min-w-0 flex-1 gap-0.5">
                  <strong className="truncate text-sm">/{skill.name}</strong>
                  {skill.trigger ? <small className="block truncate text-xs font-normal text-muted-foreground">{skill.trigger}</small> : null}
                </span>
              </Button>
            ))}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}
