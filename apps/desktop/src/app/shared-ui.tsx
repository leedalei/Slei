import { type FormEvent, useEffect, useState } from "react";
import { Pencil } from "lucide-react";

import { createDesktopMessages, type DesktopMessages } from "../i18n";
import { createMemberAvatar, type AvatarIdentity } from "./member-avatar";
import type { EmptySize, EmptyVariant } from "./model";
import type { SleiMessage } from "./fixtures";

export function MemberAvatar({ identity, large = false }: { identity: AvatarIdentity; large?: boolean }) {
  const fallback = identity.avatar || identity.name.slice(0, 2);
  return (
    <span className={`slei-avatar${large ? " slei-avatar--large" : ""}`} title={identity.name}>
      <img alt="" aria-hidden="true" className="slei-avatar__image" src={createMemberAvatar(identity)} />
      <span className="slei-avatar__fallback">{fallback}</span>
    </span>
  );
}

export function Empty(input: {
  title: string;
  description?: string;
  variant?: EmptyVariant;
  size?: EmptySize;
  centered?: boolean;
}) {
  const variant = input.variant ?? "nodata";
  const size = input.size ?? "md";

  return (
    <section className={`slei-empty slei-empty--${variant} slei-empty--${size}${input.centered ? " slei-empty-detail" : ""}`} role="status">
      <div className="slei-empty__pixel-face" aria-hidden="true">
        <span className="slei-empty__pixel slei-empty__pixel--eye slei-empty__pixel--left" />
        <span className="slei-empty__pixel slei-empty__pixel--eye slei-empty__pixel--right" />
        <span className="slei-empty__pixel slei-empty__pixel--mouth" />
        <span className="slei-empty__pixel slei-empty__pixel--mark" />
      </div>
      <div className="slei-empty__copy">
        <h2>{input.title}</h2>
        {input.description ? <p>{input.description}</p> : null}
      </div>
    </section>
  );
}

export function MessageStatusSquare({ status }: { status?: SleiMessage["status"] }) {
  const tone = messageStatusSquare(status);
  if (!tone) return null;
  return (
    <span
      aria-label={status}
      className={`slei-message-status-square slei-message-status-square--${tone}`}
      role="img"
      title={status}
    />
  );
}

export function StatusDot({ status }: { status: "idle" | "busy" | "offline" }) {
  return <span aria-label={status} className={`slei-status-dot slei-status-dot--${status}`} role="img" />;
}

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

function messageStatusSquare(status?: SleiMessage["status"]): "running" | "approval" | "failed" | "pending" | undefined {
  if (status === "running") return "running";
  if (status === "approval") return "approval";
  if (status === "failed") return "failed";
  if (status === "pending" || status === "undecided") return "pending";
  return undefined;
}
