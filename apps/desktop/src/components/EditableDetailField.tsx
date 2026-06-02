import { type FormEvent, useEffect, useState } from "react";
import { Pencil } from "lucide-react";

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
    <section className={`${input.sectionClassName ?? "slei-detail-section"} slei-editable-field`}>
      <div className="slei-editable-field__label">
        <Heading>{input.label}</Heading>
        {!editing ? (
          <button aria-label={input.ariaLabel} className="slei-editable-field__edit" onClick={() => setEditing(true)} type="button">
            <Pencil aria-hidden="true" size={14} />
          </button>
        ) : null}
      </div>
      {editing ? (
        <form className="slei-editable-field__editor" onSubmit={save}>
          {input.multiline ? (
            <textarea
              aria-label={input.inputAriaLabel ?? `${input.label}${messages.common.input}`}
              className="slei-textarea"
              onChange={(event) => setDraft(event.currentTarget.value)}
              value={draft}
            />
          ) : (
            <input
              aria-label={input.inputAriaLabel ?? `${input.label}${messages.common.input}`}
              className="slei-input"
              onChange={(event) => setDraft(event.currentTarget.value)}
              value={draft}
            />
          )}
          <div className="slei-editable-field__actions">
            <button className="slei-button slei-button--small slei-button--accent" type="submit">{messages.common.save}</button>
            <button className="slei-button slei-button--small" onClick={cancel} type="button">{messages.common.cancel}</button>
          </div>
        </form>
      ) : (
        <p className={input.readClassName}>{input.value}</p>
      )}
    </section>
  );
}
