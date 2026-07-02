import type { DesktopMessages } from "../../i18n";
import type { SleiIconName } from "../../components";
import type { SkillView } from "../../lib/daemon-bridge";
import { SelectableCard, SleiIcon } from "../../components";
import { Button } from "../../components/ui/button";
import { Card, CardContent } from "../../components/ui/card";
import { ScrollArea } from "../../components/ui/scroll-area";

export type ComposerCommandOption =
  | { kind: "command"; id: "insert-file" | "convert-to-task"; title: string; description: string; aliases: string[]; icon: SleiIconName }
  | { kind: "skill"; id: string; name: string; trigger?: string };

export function ComposerCommandPicker({
  messages,
  onSelect,
  optionRef,
  options,
  selectedIndex,
}: {
  messages: DesktopMessages;
  onSelect: (index: number) => void;
  optionRef?: (index: number, node: HTMLButtonElement | null) => void;
  options: ComposerCommandOption[];
  selectedIndex: number;
}) {
  if (options.length === 0) return null;

  return (
    <Card aria-label={messages.chat.chooseComposerCommand} className="max-h-[12.5rem] w-full max-w-full gap-2 overflow-hidden py-2" data-testid="slei-composer-command-panel">
      <CardContent className="grid min-h-0 gap-1 px-2">
        <ScrollArea className="max-h-[10.5rem] min-h-0 pr-2">
          <div className="grid min-w-0 gap-1">
            {options.map((option, index) => (
              <SelectableCard asChild key={`${option.kind}-${option.id}`} selected={index === selectedIndex}>
                <Button
                  aria-current={index === selectedIndex ? "true" : undefined}
                  className="h-auto min-h-12 w-full min-w-0 max-w-full overflow-hidden justify-start gap-2 px-2 py-2 text-left text-inherit hover:text-inherit"
                  data-composer-command-id={option.kind === "command" ? option.id : undefined}
                  data-composer-option-index={index}
                  data-composer-skill-id={option.kind === "skill" ? option.id : undefined}
                  onClick={() => onSelect(index)}
                  ref={(node) => optionRef?.(index, node)}
                  type="button"
                  variant="ghost"
                >
                  {option.kind === "command" ? <SleiIcon className="shrink-0 text-muted-foreground" name={option.icon} size={15} /> : null}
                  <span className="grid min-w-0 flex-1 gap-0.5">
                    <strong className="truncate text-sm">{option.kind === "command" ? option.title : `/${option.name}`}</strong>
                    <small className="block truncate text-xs font-normal text-muted-foreground">
                      {option.kind === "command" ? option.description : option.trigger}
                    </small>
                  </span>
                </Button>
              </SelectableCard>
            ))}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}

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
    <ComposerCommandPicker
      messages={messages}
      onSelect={onSelect}
      optionRef={optionRef}
      options={skills.map((skill) => ({ kind: "skill", id: skill.id, name: skill.name, trigger: skill.trigger }))}
      selectedIndex={selectedIndex}
    />
  );
}
