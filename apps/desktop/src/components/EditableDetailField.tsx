import { type FormEvent, useEffect, useId, useState } from "react";
import { Pencil } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

import { createDesktopMessages, type DesktopMessages } from "../i18n";

export function EditableDetailField(input: {
  ariaLabel: string;
  inputAriaLabel?: string;
  initialEditing?: boolean;
  label: string;
  messages?: DesktopMessages;
  multiline?: boolean;
  onSave?: (value: string) => void;
  readClassName?: string;
  sectionClassName?: string;
  titleTag?: "h2" | "h3";
  value: string;
}) {
  const [editing, setEditing] = useState(input.initialEditing ?? false);
  const [draft, setDraft] = useState(input.value);
  const messages = input.messages ?? createDesktopMessages("zh-CN");
  const Heading = input.titleTag ?? "h3";
  const fieldId = useId();

  useEffect(() => {
    if (editing) return;
    setDraft(input.value);
  }, [editing, input.value]);

  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextValue = draft.trim();
    if (!nextValue) return;
    input.onSave?.(nextValue);
    setEditing(false);
  }

  function cancel() {
    setDraft(input.value);
    setEditing(false);
  }

  return (
    <section className={cn("grid gap-2", input.sectionClassName ?? "slei-detail-section")}>
      <div className="flex items-center justify-between gap-2">
        <Heading className="text-base font-semibold">{input.label}</Heading>
        {!editing ? (
          <Button aria-label={input.ariaLabel} onClick={() => setEditing(true)} size="icon-sm" type="button" variant="ghost">
            <Pencil aria-hidden="true" className="size-3.5" />
          </Button>
        ) : null}
      </div>
      {editing ? (
        <form className="grid gap-3" onSubmit={save}>
          <Label className="sr-only" htmlFor={fieldId}>
            {input.label}
          </Label>
          {input.multiline ? (
            <Textarea
              aria-label={input.inputAriaLabel ?? `${input.label}${messages.common.input}`}
              id={fieldId}
              onChange={(event) => setDraft(event.currentTarget.value)}
              value={draft}
            />
          ) : (
            <Input
              aria-label={input.inputAriaLabel ?? `${input.label}${messages.common.input}`}
              id={fieldId}
              onChange={(event) => setDraft(event.currentTarget.value)}
              value={draft}
            />
          )}
          <div className="flex flex-wrap gap-2">
            <Button size="sm" type="submit">{messages.common.save}</Button>
            <Button onClick={cancel} size="sm" type="button" variant="outline">{messages.common.cancel}</Button>
          </div>
        </form>
      ) : (
        <p className={cn("text-sm text-muted-foreground", input.readClassName)}>{input.value}</p>
      )}
    </section>
  );
}
