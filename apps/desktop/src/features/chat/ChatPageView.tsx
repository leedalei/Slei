import { useEffect, useRef, useState } from "react";
import { ArrowDown, AtSign, Bookmark, CheckSquare, Copy, FileText, Hash, History, Image as ImageIcon, MessageCircle, Paperclip, Plus, Send, X } from "lucide-react";

import type { DesktopMessages } from "../../i18n";
import type { ConversationAttachmentUploadRequest, ConversationAttachmentView, ConversationView, InteractiveCardView, PermissionDecision } from "../../lib/daemon-bridge";
import type { SleiFixtures, SleiMember, SleiMessage } from "../../app/fixtures";
import { MarkdownMessage } from "./MarkdownMessage";
import { activeMentionQuery, composerShortcutAction, filterConversationMessages, formatMessageTime, insertMention, isComposerImeComposing, mentionSuggestions, moveMentionSelection, stripChannelHash, submitComposerDraft, type AgentDraftInput, type UserProfile } from "../../app/model";
import { CheckboxControl, MemberAvatar, memberFromMessage, MessageStatusSquare, StatusDot, Toast } from "../../components";

export type ChannelEmbeddedView = "chat" | "tasks" | "files";

function InteractiveCard({ card, messages, onCreate, onPermissionResolve }: { card: InteractiveCardView; messages: DesktopMessages; onCreate?: () => void; onPermissionResolve?: (requestId: string, decision: PermissionDecision) => Promise<void> | void }) {
  if (card.kind === "permissionApproval") {
    const done = card.state !== "pending";
    const requestId = typeof card.draft.requestId === "string" ? card.draft.requestId : "";
    const targetPath = typeof card.draft.targetPath === "string" ? card.draft.targetPath : card.summary;
    const toolName = typeof card.draft.toolName === "string" ? card.draft.toolName : "Write";
    return (
      <article className="slei-agent-draft-card slei-interactive-card slei-interactive-card--permissionApproval">
        <div>
          <span className="slei-badge slei-badge--attention">权限申请</span>
          <h2>{card.title}</h2>
          <p>{toolName} 需要写入工作区外路径：{targetPath}</p>
          <small>仅影响当前会话；新会话会重新申请。</small>
        </div>
        <div className="slei-permission-actions">
          <button className="slei-button slei-button--accent" disabled={done || !requestId} onClick={() => onPermissionResolve?.(requestId, "approve_once")} type="button">
            允许一次
          </button>
          <button className="slei-button" disabled={done || !requestId} onClick={() => onPermissionResolve?.(requestId, "approve_session")} type="button">
            本会话始终允许
          </button>
          <button className="slei-button slei-button--danger" disabled={done || !requestId} onClick={() => onPermissionResolve?.(requestId, "deny")} type="button">
            拒绝
          </button>
        </div>
      </article>
    );
  }
  const done = card.state !== "pending";
  const doneLabel = card.doneLabel === "DONE" ? messages.common.done : card.doneLabel || messages.common.done;
  return (
    <article className={`slei-agent-draft-card slei-interactive-card slei-interactive-card--${card.kind}`}>
      <div>
        <h2>{card.title}</h2>
        <p>{card.summary}</p>
      </div>
      <button className="slei-button slei-button--accent slei-button--small" disabled={done} onClick={onCreate} type="button">
        {done ? doneLabel : card.actionLabel || messages.common.create}
      </button>
    </article>
  );
}

function AttachmentList({ attachments, messageAttachments = false, onRemove }: { attachments: ConversationAttachmentView[]; messageAttachments?: boolean; onRemove?: (attachmentId: string) => void }) {
  if (attachments.length === 0) return null;
  return (
    <div className={messageAttachments ? "slei-message-attachments" : "slei-composer-attachments"}>
      {attachments.map((attachment) => {
        const isImage = attachment.mimeType.startsWith("image/");
        return (
          <span className="slei-attachment-chip" key={attachment.id}>
            {isImage && attachment.url ? <img alt="" className="slei-attachment-preview" src={attachment.url} /> : <FileText aria-hidden="true" size={14} />}
            <span>{attachment.name}</span>
            <small>{formatAttachmentSize(attachment.size)}</small>
            {onRemove ? (
              <button aria-label={`Remove ${attachment.name}`} onClick={() => onRemove(attachment.id)} type="button">
                <X aria-hidden="true" size={12} />
              </button>
            ) : null}
          </span>
        );
      })}
    </div>
  );
}

function formatAttachmentSize(size: number) {
  if (size < 1024) return `${size} B`;
  const kilobytes = size / 1024;
  if (kilobytes < 1024) return `${Math.round(kilobytes)} KB`;
  return `${(kilobytes / 1024).toFixed(1)} MB`;
}

function memberMatchingMessage(message: SleiMessage, members: SleiMember[]): SleiMember | undefined {
  const normalizedHandle = message.handle?.toLowerCase();
  const normalizedAuthor = message.author.toLowerCase();
  return members.find(
    (member) =>
      member.handle.toLowerCase() === normalizedHandle ||
      member.name.toLowerCase() === normalizedAuthor,
  );
}

function messageRoleDescription(message: SleiMessage, members: SleiMember[], messages: DesktopMessages): string {
  return memberMatchingMessage(message, members)?.role ?? messages.chat.roleLabels[message.role];
}

async function copyMessageBody(body: string) {
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(body);
    return true;
  }
  if (typeof document === "undefined") return false;

  const textarea = document.createElement("textarea");
  textarea.value = body;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  const copied = document.execCommand("copy");
  textarea.remove();
  return copied;
}

function formatConversationDateTime(value: string): string {
  const raw = value.trim();
  if (!raw) return "";
  const direct = raw.match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}:\d{2})/);
  if (direct) return `${direct[1]} ${direct[2]}`;

  let date: Date;
  if (/^\d+$/.test(raw)) {
    const numeric = BigInt(raw);
    const milliseconds =
      raw.length >= 16
        ? numeric / 1_000_000n
        : raw.length >= 13
          ? numeric
          : numeric * 1_000n;
    date = new Date(Number(milliseconds));
  } else {
    date = new Date(raw);
  }
  if (Number.isNaN(date.getTime())) return raw;
  return date.toISOString().slice(0, 19).replace("T", " ");
}

function sessionCreatedTime(session: { createdAt: string }) {
  const parsed = Date.parse(session.createdAt);
  return Number.isNaN(parsed) ? 0 : parsed;
}

async function uploadComposerFile(
  file: File,
  onAttachmentUpload?: (request: ConversationAttachmentUploadRequest) => Promise<{ attachment: ConversationAttachmentView }>,
): Promise<ConversationAttachmentView | null> {
  const bytesBase64 = await fileToBase64(file);
  if (onAttachmentUpload) {
    return (await onAttachmentUpload({ name: file.name, mimeType: file.type || "application/octet-stream", bytesBase64 })).attachment;
  }
  return {
    id: `local-${file.name}-${file.size}`,
    name: file.name,
    mimeType: file.type || "application/octet-stream",
    size: file.size,
    url: file.type.startsWith("image/") ? `data:${file.type};base64,${bytesBase64}` : undefined,
  };
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      const result = String(reader.result ?? "");
      resolve(result.includes(",") ? result.split(",").pop() ?? "" : result);
    });
    reader.addEventListener("error", () => reject(reader.error ?? new Error("file read failed")));
    reader.readAsDataURL(file);
  });
}

export function ChatPage({ activeChannel, activeConversation, activeSessionId, data, focusedMessageId, initialAttachments, initialChannelView, initialDraft, messages, onAgentDraftCreate, onAttachmentUpload, onChannelDraftCreate, onConversationHistoryToggle, onConversationNewSession, onConversationSessionSelect, onMessageSaveToggle, onPermissionResolve, onSendMessage, profile, savedMessageIds = [], sending, sessionDrawerOpen }: { activeChannel: SleiFixtures["channels"][number]; activeConversation?: ConversationView; activeSessionId?: string; data: SleiFixtures; focusedMessageId?: string; initialAttachments?: ConversationAttachmentView[]; initialChannelView?: ChannelEmbeddedView; initialDraft?: string; messages: DesktopMessages; onAgentDraftCreate?: (draft: Partial<AgentDraftInput>, cardId?: string) => void; onAttachmentUpload?: (request: ConversationAttachmentUploadRequest) => Promise<{ attachment: ConversationAttachmentView }>; onChannelDraftCreate?: (draft: Record<string, unknown>, cardId?: string) => void; onConversationHistoryToggle?: () => void; onConversationNewSession?: (conversationId: string) => Promise<void> | void; onConversationSessionSelect?: (conversationId: string, sessionId: string) => Promise<void> | void; onMessageSaveToggle?: (message: SleiMessage) => Promise<void> | void; onPermissionResolve?: (requestId: string, decision: PermissionDecision) => Promise<void> | void; onSendMessage?: (body: string, options?: { asTask?: boolean; attachmentIds?: string[]; sessionId?: string }) => Promise<void> | void; profile: UserProfile; savedMessageIds?: string[]; sending?: boolean; sessionDrawerOpen?: boolean }) {
  const [draft, setDraft] = useState(initialDraft ?? "");
  const [asTask, setAsTask] = useState(false);
  const [attachments, setAttachments] = useState<ConversationAttachmentView[]>(initialAttachments ?? []);
  const [channelView, setChannelView] = useState<ChannelEmbeddedView>(initialChannelView ?? "chat");
  const [isComposing, setIsComposing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [selectedMentionIndex, setSelectedMentionIndex] = useState(0);
  const [toastMessage, setToastMessage] = useState("");
  const [highlightedMessageId, setHighlightedMessageId] = useState<string | undefined>(focusedMessageId);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const mention = activeMentionQuery(draft);
  const mentionTargets = mention ? mentionSuggestions(mention.query, data.members) : [];
  const dmMember = activeConversation?.kind === "dm" ? data.members.find((member) => member.id === activeConversation.agentId) : undefined;
  const activeTargetId = activeConversation?.id ?? activeChannel.id;
  const currentSessionId = activeSessionId ?? activeConversation?.activeSessionId;
  const visibleMessages = filterConversationMessages(data.messages, {
    channel: activeTargetId,
  }).filter((message) => {
    if (!activeConversation) return true;
    if (!currentSessionId) return false;
    return message.sessionId === currentSessionId;
  });
  const activeSessions = activeConversation ? data.conversationSessions.filter((session) => session.conversationId === activeConversation.id) : [];
  const sortedActiveSessions = [...activeSessions].sort((left, right) => sessionCreatedTime(right) - sessionCreatedTime(left));
  const activeSession = activeSessions.find((session) => session.id === currentSessionId) ?? sortedActiveSessions[0];
  const allowAsTask = !dmMember;
  const effectiveChannelView: ChannelEmbeddedView = dmMember ? "chat" : channelView;
  const detailTitle = dmMember ? activeSession?.title.trim() || messages.chat.newSession : stripChannelHash(activeChannel.name);
  const detailAriaLabel = dmMember ? detailTitle : `# ${detailTitle}`;
  const detailSubtitle = dmMember
    ? `${dmMember.name} ｜ ${formatConversationDateTime(activeSession?.createdAt ?? activeConversation?.createdAt ?? "")}`
    : activeChannel.projectName ? messages.chat.projectPrefix(activeChannel.projectName) : activeChannel.description;
  const sessionBusy = Boolean(activeConversation && visibleMessages.some((message) => message.status === "running" || message.status === "pending"));
  const sendDisabled = Boolean((!draft.trim() && attachments.length === 0) || sessionBusy || sending || submitting);

  useEffect(() => {
    setChannelView(initialChannelView ?? "chat");
  }, [activeChannel.id, activeConversation?.id, initialChannelView]);

  useEffect(() => {
    if (!focusedMessageId || typeof document === "undefined") return;
    const target = document.querySelector<HTMLElement>(`[data-message-id="${escapeAttributeSelector(focusedMessageId)}"]`);
    if (!target) return;
    target.scrollIntoView({ block: "center" });
    target.focus({ preventScroll: true });
    setHighlightedMessageId(focusedMessageId);
    const timer = window.setTimeout(() => setHighlightedMessageId(undefined), 2200);
    return () => window.clearTimeout(timer);
  }, [focusedMessageId, visibleMessages.length]);

  async function submitMessage() {
    if (sendDisabled) return;
    setSubmitting(true);
    try {
      const result = await submitComposerDraft({
        draft,
        asTask: allowAsTask ? asTask : false,
        attachments,
        sessionId: currentSessionId,
        onSendMessage,
      });
      if (result.sent) {
        setDraft(result.draft);
        setAttachments(result.attachments);
        setAsTask(result.asTask);
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function addFiles(fileList: FileList | null) {
    if (!fileList) return;
    const files = Array.from(fileList);
    const uploaded = await Promise.all(files.map((file) => uploadComposerFile(file, onAttachmentUpload)));
    setAttachments((current) => [...current, ...uploaded.filter((attachment): attachment is ConversationAttachmentView => Boolean(attachment))]);
  }

  function selectMention(index = selectedMentionIndex) {
    if (!mention || !mentionTargets[index]) return;
    setDraft(insertMention(draft, mention, mentionTargets[index].handle));
    setSelectedMentionIndex(0);
  }

  async function copyMessage(message: SleiMessage) {
    const copied = await copyMessageBody(message.body);
    if (!copied) return;
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToastMessage(messages.chat.copySuccess);
    toastTimerRef.current = setTimeout(() => setToastMessage(""), 1800);
  }

  return (
    <section className="slei-chat-page">
      <Toast message={toastMessage} />
      <header className="slei-workspace-header">
        <div>
          <h1 aria-label={detailAriaLabel}>{dmMember ? <MessageCircle aria-hidden="true" size={22} /> : <Hash aria-hidden="true" size={22} />}<span>{detailTitle}</span></h1>
          <p>{detailSubtitle}</p>
        </div>
        {dmMember && activeConversation ? (
          <div className="slei-chat-header-actions">
            <button className="slei-button slei-button--small" onClick={() => onConversationNewSession?.(activeConversation.id)} type="button">
              <Plus aria-hidden="true" size={14} />{messages.chat.newSession}
            </button>
            <button className="slei-button slei-button--small" onClick={onConversationHistoryToggle} type="button">
              <History aria-hidden="true" size={14} />{messages.chat.history}
            </button>
          </div>
        ) : (
          <>
            <nav aria-label={messages.chat.channelView} className="slei-chat-tabs">
              <button aria-current={effectiveChannelView === "chat" ? "page" : undefined} onClick={() => setChannelView("chat")} type="button"><MessageCircle aria-hidden="true" size={14} />{messages.shell.nav.chat}</button>
              <button aria-current={effectiveChannelView === "tasks" ? "page" : undefined} onClick={() => setChannelView("tasks")} type="button"><CheckSquare aria-hidden="true" size={14} />{messages.chat.tasks}</button>
              <button aria-current={effectiveChannelView === "files" ? "page" : undefined} onClick={() => setChannelView("files")} type="button"><FileText aria-hidden="true" size={14} />{messages.chat.files}</button>
            </nav>
          </>
        )}
      </header>
      {sessionDrawerOpen && activeConversation ? (
        <aside aria-label={messages.chat.history} className="slei-session-drawer">
          <header>
            <h2>{messages.chat.history}</h2>
            <button aria-label={messages.common.cancel} className="slei-icon-button" onClick={onConversationHistoryToggle} type="button"><X aria-hidden="true" size={14} /></button>
          </header>
          <div className="slei-session-list">
            {sortedActiveSessions.map((session) => (
              <button
                aria-current={session.id === currentSessionId ? "true" : undefined}
                className="slei-session-item"
                key={session.id}
                onClick={() => onConversationSessionSelect?.(activeConversation.id, session.id)}
                type="button"
              >
                <strong>{session.title || messages.chat.newSession}</strong>
                <small>{formatConversationDateTime(session.createdAt)}</small>
              </button>
            ))}
          </div>
        </aside>
      ) : null}
      <div className="slei-timeline">
        {visibleMessages.map((message) => {
          const saved = savedMessageIds.includes(message.id);
          const saveLabel = saved ? messages.chat.unsaveMessage : messages.chat.saveMessage;
          return (
          <article className={`slei-message${highlightedMessageId === message.id ? " slei-message--focused" : ""}`} data-message-id={message.id} key={message.id} tabIndex={focusedMessageId === message.id ? -1 : undefined}>
            <MemberAvatar identity={memberFromMessage(message, data.members)} />
            <div>
              <div className="slei-message__meta">
                <div className="slei-message__identity">
                  <strong>{message.author}</strong>
                  {message.handle ? <span>{message.handle}</span> : null}
                  <span aria-hidden="true">｜</span>
                  <span>{messageRoleDescription(message, data.members, messages)}</span>
                </div>
                <div className="slei-message__actions">
                  <button aria-label={messages.chat.copyMessage} className="slei-message__copy" onClick={() => void copyMessage(message)} title={messages.chat.copyMessage} type="button">
                    <Copy aria-hidden="true" size={14} />
                  </button>
                  <button aria-label={saveLabel} aria-pressed={saved ? "true" : "false"} className="slei-message__copy slei-message__save" onClick={() => void onMessageSaveToggle?.(message)} title={saveLabel} type="button">
                    <Bookmark aria-hidden="true" size={14} />
                  </button>
                  <span aria-hidden="true" className="slei-message__meta-separator">｜</span>
                  <span className="slei-message__time-row">
                    <time>{message.time}</time>
                    <MessageStatusSquare status={message.status} />
                  </span>
                </div>
              </div>
              <MarkdownMessage markdown={message.body} />
              <AttachmentList attachments={message.attachments ?? []} messageAttachments />
              {message.toolCall ? <code className="slei-tool-call">{message.toolCall}</code> : null}
              {message.cards?.map((card) => (
                <InteractiveCard
                  card={card}
                  key={card.id}
                  messages={messages}
                  onCreate={() => {
                    if (card.kind === "createAgent") {
                      onAgentDraftCreate?.(card.draft as Partial<AgentDraftInput>, card.id);
                    } else if (card.kind === "createChannel") {
                      onChannelDraftCreate?.(card.draft, card.id);
                    }
                  }}
                  onPermissionResolve={onPermissionResolve}
                />
              ))}
            </div>
          </article>
        );})}
      </div>
      {mention && mentionTargets.length > 0 ? (
        <section aria-label={messages.chat.chooseMentionMember} className="slei-mention-panel">
          {mentionTargets.map((member, index) => (
            <button
              aria-current={index === selectedMentionIndex ? "true" : undefined}
              className="slei-mention-option"
              key={member.id}
              onClick={() => selectMention(index)}
              type="button"
            >
              <MemberAvatar identity={member} />
              <strong>{member.name}</strong>
              <StatusDot status={member.runtimeStatus} />
              <small>{member.role}</small>
              <span><AtSign aria-hidden="true" size={12} />{member.handle}</span>
            </button>
          ))}
          <button className="slei-back-bottom" type="button"><ArrowDown aria-hidden="true" size={14} />{messages.chat.backToBottom}</button>
        </section>
      ) : null}
      <form className="slei-composer" onSubmit={(event) => { event.preventDefault(); void submitMessage(); }}>
        {attachments.length > 0 ? (
          <AttachmentList
            attachments={attachments}
            onRemove={(attachmentId) => setAttachments((current) => current.filter((attachment) => attachment.id !== attachmentId))}
          />
        ) : null}
        <textarea
          className="slei-textarea"
          onCompositionEnd={() => setIsComposing(false)}
          onCompositionStart={() => setIsComposing(true)}
          onChange={(event) => setDraft(event.currentTarget.value)}
          onKeyDown={(event) => {
            const composing = isComposerImeComposing({ composing: isComposing, nativeEvent: event.nativeEvent });
            const hasMentionTargets = Boolean(mention && mentionTargets.length > 0);
            if (!composing && mention && mentionTargets.length > 0) {
              if (event.key === "ArrowDown") {
                event.preventDefault();
                setSelectedMentionIndex((current) => moveMentionSelection(current, 1, mentionTargets.length));
                return;
              }
              if (event.key === "ArrowUp") {
                event.preventDefault();
                setSelectedMentionIndex((current) => moveMentionSelection(current, -1, mentionTargets.length));
                return;
              }
              if (event.key === "Escape") {
                event.preventDefault();
                setDraft(draft.slice(0, mention.start));
                return;
              }
            }
            const action = composerShortcutAction({ key: event.key, shiftKey: event.shiftKey, composing, hasMentionTargets });
            if (action === "selectMention") {
              event.preventDefault();
              selectMention();
              return;
            }
            if (action === "submit") {
              event.preventDefault();
              void submitMessage();
            }
          }}
          placeholder={dmMember ? messages.chat.inputToMember(dmMember.name) : messages.chat.inputToChannel(stripChannelHash(activeChannel.name))}
          aria-label={dmMember ? messages.chat.inputToMember(dmMember.name) : messages.chat.inputToChannel(stripChannelHash(activeChannel.name))}
          value={draft}
        />
        <div className="slei-composer__actions">
          {allowAsTask ? <CheckboxControl checked={asTask} className="slei-task-toggle" label={messages.chat.asTask} onChange={setAsTask} /> : null}
          <div className="slei-composer__tools">
            <input accept="image/*" hidden onChange={(event) => void addFiles(event.currentTarget.files)} ref={imageInputRef} type="file" />
            <input hidden onChange={(event) => void addFiles(event.currentTarget.files)} ref={fileInputRef} type="file" />
            <button aria-label={messages.common.addImage} className="slei-icon-button" onClick={() => imageInputRef.current?.click()} type="button"><ImageIcon aria-hidden="true" size={15} /></button>
            <button aria-label={messages.common.addAttachment} className="slei-icon-button" onClick={() => fileInputRef.current?.click()} type="button"><Paperclip aria-hidden="true" size={15} /></button>
          </div>
          <button className="slei-button slei-button--accent slei-send-button" data-testid="slei-send-button" disabled={sendDisabled} type="submit"><Send aria-hidden="true" size={15} />{messages.common.send}</button>
        </div>
      </form>
    </section>
  );
}

function escapeAttributeSelector(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/"/g, "\\\"");
}
