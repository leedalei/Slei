import { type ComponentProps, type FormEvent, type KeyboardEvent, useEffect, useId, useRef, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

import { createDesktopMessages, type DesktopMessages } from "../i18n";
import { SleiIcon } from "./SleiIcon";

export function EditableDetailField(input: {
  ariaLabel: string;
  inputAriaLabel?: string;
  initialEditing?: boolean;
  label: string;
  messages?: DesktopMessages;
  multiline?: boolean;
  onSave?: (value: string) => Promise<void> | void;
  allowEmpty?: boolean;
  saving?: boolean;
  error?: string;
  readClassName?: string;
  readBadgeVariant?: ComponentProps<typeof Badge>["variant"];
  sectionClassName?: string;
  titleTag?: "h2" | "h3";
  value: string;
}) {
  const [editing, setEditing] = useState(input.initialEditing ?? false);
  const [draft, setDraft] = useState(input.value);
  const [internalSaving, setInternalSaving] = useState(false);
  const [localError, setLocalError] = useState<string | undefined>();
  const saveInFlightRef = useRef(false);
  const messages = input.messages ?? createDesktopMessages("zh-CN");
  const Heading = input.titleTag ?? "h3";
  const fieldId = useId();
  const errorId = `${fieldId}-error`;
  const isSaving = input.saving ?? internalSaving;
  const errorMessage = input.error ?? localError;

  useEffect(() => {
    if (editing) return;
    setDraft(input.value);
  }, [editing, input.value]);

  async function saveDraft() {
    await commitEditableDetailSave({
      allowEmpty: input.allowEmpty,
      draft,
      isSaving,
      managesSaving: input.saving === undefined,
      onError: setLocalError,
      onSave: input.onSave,
      onSuccess: () => {
        setLocalError(undefined);
        setEditing(false);
      },
      saveInFlightRef,
      setInternalSaving,
    });
  }

  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void saveDraft();
  }

  function cancel() {
    setDraft(input.value);
    setLocalError(undefined);
    setEditing(false);
  }

  function onEditorKeyDown(event: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) {
    const action = getEditableDetailKeyAction(event, input.multiline);
    if (action === "cancel") {
      event.preventDefault();
      cancel();
      return;
    }

    if (action === "save") {
      event.preventDefault();
      void saveDraft();
    }
  }

  return (
    <section
      className={cn("slei-editable-field grid gap-2", input.sectionClassName ?? "slei-detail-section")}
      data-editable-saving={isSaving ? "true" : undefined}
    >
      <div className="slei-editable-field__label flex items-center justify-between gap-2">
        <Heading className="text-base font-semibold">{input.label}</Heading>
        {!editing ? (
          <Button
            aria-label={input.ariaLabel}
            className="slei-editable-field__edit"
            onClick={() => setEditing(true)}
            size="icon-sm"
            type="button"
            variant="ghost"
          >
            <SleiIcon className="size-3.5" name="pencil" />
          </Button>
        ) : null}
      </div>
      {editing ? (
        <form className="slei-editable-field__editor grid gap-3" onSubmit={save}>
          <Label className="sr-only" htmlFor={fieldId}>
            {input.label}
          </Label>
          {input.multiline ? (
            <Textarea
              aria-label={input.inputAriaLabel ?? `${input.label}${messages.common.input}`}
              aria-describedby={errorMessage ? errorId : undefined}
              aria-disabled={isSaving ? true : undefined}
              aria-invalid={errorMessage ? true : undefined}
              disabled={isSaving}
              id={fieldId}
              onChange={(event) => setDraft(event.currentTarget.value)}
              onKeyDown={onEditorKeyDown}
              value={draft}
            />
          ) : (
            <Input
              aria-label={input.inputAriaLabel ?? `${input.label}${messages.common.input}`}
              aria-describedby={errorMessage ? errorId : undefined}
              aria-disabled={isSaving ? true : undefined}
              aria-invalid={errorMessage ? true : undefined}
              disabled={isSaving}
              id={fieldId}
              onChange={(event) => setDraft(event.currentTarget.value)}
              onKeyDown={onEditorKeyDown}
              value={draft}
            />
          )}
          {errorMessage ? (
            <p className="text-sm text-destructive" id={errorId} role="alert">
              {errorMessage}
            </p>
          ) : null}
          <div className="slei-editable-field__actions flex flex-wrap gap-2">
            <Button aria-disabled={isSaving ? true : undefined} disabled={isSaving} size="sm" type="submit">
              {messages.common.save}
            </Button>
            <Button
              aria-disabled={isSaving ? true : undefined}
              disabled={isSaving}
              onClick={cancel}
              size="sm"
              type="button"
              variant="outline"
            >
              {messages.common.cancel}
            </Button>
          </div>
        </form>
      ) : input.readBadgeVariant ? (
        <Badge className={input.readClassName} variant={input.readBadgeVariant}>{input.value}</Badge>
      ) : (
        <p className={cn("text-sm text-muted-foreground", input.readClassName)}>{input.value}</p>
      )}
    </section>
  );
}

type EditableDetailSaveInFlightRef = {
  current: boolean;
};

type EditableDetailSaveResult =
  | { status: "blocked" }
  | { status: "failed"; message: string }
  | { status: "saved"; value: string }
  | { status: "skipped" };

export async function commitEditableDetailSave(input: {
  allowEmpty?: boolean;
  draft: string;
  isSaving: boolean;
  managesSaving: boolean;
  onError: (message: string) => void;
  onSave?: (value: string) => Promise<void> | void;
  onSuccess: () => void;
  saveInFlightRef: EditableDetailSaveInFlightRef;
  setInternalSaving?: (saving: boolean) => void;
}): Promise<EditableDetailSaveResult> {
  if (input.isSaving || input.saveInFlightRef.current) return { status: "skipped" };

  const prepared = prepareEditableDetailSave(input.draft, input.allowEmpty);
  if (!prepared.ok) return { status: "blocked" };

  input.saveInFlightRef.current = true;
  if (input.managesSaving) input.setInternalSaving?.(true);
  try {
    await input.onSave?.(prepared.value);
    input.onSuccess();
    return { status: "saved", value: prepared.value };
  } catch (error) {
    const message = prepareEditableDetailSave.errorMessage(error);
    input.onError(message);
    return { status: "failed", message };
  } finally {
    input.saveInFlightRef.current = false;
    if (input.managesSaving) input.setInternalSaving?.(false);
  }
}

export function getEditableDetailKeyAction(
  event: { isComposing?: boolean; key: string; nativeEvent?: { isComposing?: boolean } },
  multiline = false,
) {
  if (event.key === "Escape") return "cancel";
  if (event.key !== "Enter" || multiline) return "ignore";
  if (event.isComposing || event.nativeEvent?.isComposing) return "ignore";
  return "save";
}

export const prepareEditableDetailSave = Object.assign(
  (draft: string, allowEmpty = false) => {
    const value = draft.trim();
    if (!allowEmpty && !value) return { ok: false as const };
    return { ok: true as const, value };
  },
  {
    errorMessage: (error: unknown) =>
      error instanceof Error ? error.message : String(error),
  },
);
