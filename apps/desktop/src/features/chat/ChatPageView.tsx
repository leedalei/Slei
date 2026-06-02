import { useRef, useState } from "react";
import { ArrowDown, AtSign, CheckSquare, FileText, Hash, History, Image as ImageIcon, MessageCircle, Paperclip, RefreshCcw, Send, X } from "lucide-react";

import type { DesktopMessages } from "../../i18n";
import type { ConversationAttachmentUploadRequest, ConversationAttachmentView, ConversationView, InteractiveCardView } from "../../lib/daemon-bridge";
import type { SleiFixtures } from "../../app/fixtures";
import { MarkdownMessage } from "./MarkdownMessage";
import { activeMentionQuery, composerShortcutAction, filterConversationMessages, formatMessageTime, insertMention, isComposerImeComposing, mentionSuggestions, moveMentionSelection, stripChannelHash, submitComposerDraft, type AgentDraftInput, type UserProfile } from "../../app/model";
import { CheckboxControl, MemberAvatar, memberFromMessage, MessageStatusSquare, StatusDot } from "../../components";
function InteractiveCard({ card, messages, onCreate }: { card: InteractiveCardView; messages: DesktopMessages; onCreate?: () => void }) {
  const done = card.state === "done";
  return (
    <article className={`slei-agent-draft-card slei-interactive-card slei-interactive-card--${card.kind}`}>
      <div>
        <span className="slei-badge slei-badge--attention">{messages.chat.guide}</span>
        <h2>{card.title}</h2>
        <p>{card.summary}</p>
      </div>
      <button className="slei-button slei-button--accent" disabled={done} onClick={onCreate} type="button">
        {done ? card.doneLabel || messages.common.done : card.actionLabel || messages.common.create}
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

export function ChatPage({ activeChannel, activeConversation, activeSessionId, data, initialAttachments, initialDraft, messages, onAgentDraftCreate, onAttachmentUpload, onChannelDraftCreate, onConversationHistoryToggle, onConversationRuntimeReset, onConversationSessionSelect, onSendMessage, profile, sending, sessionDrawerOpen }: { activeChannel: SleiFixtures["channels"][number]; activeConversation?: ConversationView; activeSessionId?: string; data: SleiFixtures; initialAttachments?: ConversationAttachmentView[]; initialDraft?: string; messages: DesktopMessages; onAgentDraftCreate?: (draft: Partial<AgentDraftInput>, cardId?: string) => void; onAttachmentUpload?: (request: ConversationAttachmentUploadRequest) => Promise<{ attachment: ConversationAttachmentView }>; onChannelDraftCreate?: (draft: Record<string, unknown>, cardId?: string) => void; onConversationHistoryToggle?: () => void; onConversationRuntimeReset?: (conversationId: string) => Promise<void> | void; onConversationSessionSelect?: (conversationId: string, sessionId: string) => Promise<void> | void; onSendMessage?: (body: string, options?: { asTask?: boolean; attachmentIds?: string[]; sessionId?: string }) => Promise<void> | void; profile: UserProfile; sending?: boolean; sessionDrawerOpen?: boolean }) {
  const [draft, setDraft] = useState(initialDraft ?? "");
  const [asTask, setAsTask] = useState(false);
  const [attachments, setAttachments] = useState<ConversationAttachmentView[]>(initialAttachments ?? []);
  const [isComposing, setIsComposing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [selectedMentionIndex, setSelectedMentionIndex] = useState(0);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const mention = activeMentionQuery(draft);
  const mentionTargets = mention ? mentionSuggestions(mention.query, data.members) : [];
  const dmMember = activeConversation?.kind === "dm" ? data.members.find((member) => member.id === activeConversation.agentId) : undefined;
  const activeTargetId = activeConversation?.id ?? activeChannel.id;
  const currentSessionId = activeSessionId ?? activeConversation?.activeSessionId;
  const visibleMessages = filterConversationMessages(data.messages, {
    channel: activeTargetId,
  }).filter((message) => !activeConversation || !currentSessionId || !message.sessionId || message.sessionId === currentSessionId);
  const activeSessions = activeConversation ? data.conversationSessions.filter((session) => session.conversationId === activeConversation.id) : [];
  const activeSession = activeSessions.find((session) => session.id === currentSessionId) ?? activeSessions[0];
  const detailTitle = dmMember ? activeSession?.title.trim() || messages.chat.newSession : stripChannelHash(activeChannel.name);
  const detailAriaLabel = dmMember ? detailTitle : `# ${detailTitle}`;
  const detailSubtitle = dmMember
    ? `${dmMember.name} ｜ ${formatMessageTime(activeSession?.createdAt ?? activeConversation?.createdAt ?? "")}`
    : activeChannel.projectName ? messages.chat.projectPrefix(activeChannel.projectName) : activeChannel.description;
  const sessionBusy = Boolean(activeConversation && visibleMessages.some((message) => message.status === "running" || message.status === "pending"));
  const sendDisabled = Boolean((!draft.trim() && attachments.length === 0) || sessionBusy || sending || submitting);

  async function submitMessage() {
    if (sendDisabled) return;
    setSubmitting(true);
    try {
      const result = await submitComposerDraft({
        draft,
        asTask,
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

  return (
    <section className="slei-chat-page">
      <header className="slei-workspace-header" data-tauri-drag-region="deep">
        <div>
          <h1 aria-label={detailAriaLabel}>{dmMember ? <MessageCircle aria-hidden="true" size={22} /> : <Hash aria-hidden="true" size={22} />}<span>{detailTitle}</span></h1>
          <p>{detailSubtitle}</p>
        </div>
        {dmMember && activeConversation ? (
          <div className="slei-chat-header-actions">
            <button className="slei-button slei-button--small" onClick={() => onConversationRuntimeReset?.(activeConversation.id)} type="button">
              <RefreshCcw aria-hidden="true" size={14} />{messages.chat.resetSession}
            </button>
            <button className="slei-button slei-button--small" onClick={onConversationHistoryToggle} type="button">
              <History aria-hidden="true" size={14} />{messages.chat.history}
            </button>
          </div>
        ) : (
          <>
            <nav aria-label={messages.chat.channelView} className="slei-chat-tabs">
              <button aria-current="page" type="button"><MessageCircle aria-hidden="true" size={14} />{messages.shell.nav.chat}</button>
              <button type="button"><CheckSquare aria-hidden="true" size={14} />{messages.chat.tasks}</button>
              <button type="button"><FileText aria-hidden="true" size={14} />{messages.chat.files}</button>
            </nav>
            <span className="slei-badge slei-badge--ready">{messages.chat.runtimeDetected}</span>
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
            {activeSessions.map((session) => (
              <button
                aria-current={session.id === currentSessionId ? "true" : undefined}
                className="slei-session-item"
                key={session.id}
                onClick={() => onConversationSessionSelect?.(activeConversation.id, session.id)}
                type="button"
              >
                <strong>{session.title || messages.chat.newSession}</strong>
                <small>{formatMessageTime(session.updatedAt)}</small>
              </button>
            ))}
          </div>
        </aside>
      ) : null}
      <div className="slei-timeline">
        {visibleMessages.map((message) => (
          <article className="slei-message" key={message.id}>
            <MemberAvatar identity={memberFromMessage(message, data.members)} />
            <div>
              <div className="slei-message__meta">
                <strong>{message.author}</strong>
                {message.handle ? <span>{message.handle}</span> : null}
                <span>{message.time}</span>
                <MessageStatusSquare status={message.status} />
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
                />
              ))}
            </div>
          </article>
        ))}
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
          <CheckboxControl checked={asTask} className="slei-task-toggle" label={messages.chat.asTask} onChange={setAsTask} />
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
