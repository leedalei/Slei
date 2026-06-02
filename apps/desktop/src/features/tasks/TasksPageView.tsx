import { type CSSProperties, type FormEvent, useState } from "react";
import { MessageSquare, Send, X } from "lucide-react";

import type { DesktopMessages } from "../../i18n";
import type { SleiFixtures, SleiTask } from "../../app/fixtures";
import { MarkdownMessage } from "../chat/MarkdownMessage";
export function TasksPage({ activeTaskId, data, messages, onTaskReply }: { activeTaskId?: string; data: SleiFixtures; messages: DesktopMessages; onTaskReply?: (taskId: string, body: string) => void }) {
  const columns: SleiTask["status"][] = ["todo", "in_progress", "in_review", "done"];
  const [selectedTaskId, setSelectedTaskId] = useState(activeTaskId);
  const [replyDraft, setReplyDraft] = useState("");
  const selectedTask = data.tasks.find((task) => task.id === selectedTaskId);

  function submitReply(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const body = replyDraft.trim();
    if (!selectedTask || !body) return;
    onTaskReply?.(selectedTask.id, body);
    setReplyDraft("");
  }

  return (
    <section className="slei-tasks-page">
      <header className="slei-workspace-header" data-tauri-drag-region="deep">
        <div>
          <h1>{messages.tasks.title}</h1>
          <p>{messages.tasks.description}</p>
        </div>
        <div className="slei-segmented"><button type="button">{messages.tasks.board}</button><button type="button">{messages.tasks.list}</button></div>
      </header>
      <div className="slei-board">
        {columns.map((column) => (
          <div className="slei-column" key={column}>
            <h2>{taskStatusLabel(column, messages)}</h2>
            {data.tasks.filter((task) => task.status === column).map((task) => (
              <article className="slei-card slei-task-card" key={task.id}>
                <div className="slei-task-card__toolbar">
                  <span>{task.id}</span>
                  <button aria-label={messages.tasks.commentThread} className="slei-icon-button slei-task-comment-button" onClick={() => setSelectedTaskId(task.id)} type="button">
                    <MessageSquare aria-hidden="true" size={15} />
                    <span>{task.replies?.length ?? 0}</span>
                  </button>
                </div>
                <strong>{task.title}</strong>
                <small>{task.owner}</small>
                {task.attention ? <b className="slei-badge slei-badge--attention">{task.attention}</b> : null}
              </article>
            ))}
          </div>
        ))}
      </div>
      {selectedTask ? (
        <aside aria-label={messages.tasks.thread} className="slei-task-thread-drawer" style={{ "--task-thread-width": "680px" } as CSSProperties}>
          <header>
            <div>
              <span className="slei-badge">{taskStatusLabel(selectedTask.status, messages)}</span>
              <h2>{selectedTask.title}</h2>
              <p>{selectedTask.owner} · {(selectedTask.replies?.length ?? 0)} {messages.tasks.replies}</p>
            </div>
            <button aria-label={messages.tasks.closeThread} className="slei-icon-button" onClick={() => setSelectedTaskId(undefined)} type="button">
              <X aria-hidden="true" size={16} />
            </button>
          </header>
          <div className="slei-task-thread-replies">
            {(selectedTask.replies ?? []).map((reply) => (
              <article className={`slei-task-thread-reply slei-task-thread-reply--${reply.role ?? "human"}`} key={reply.id}>
                <strong>{reply.sender}</strong>
                <MarkdownMessage markdown={reply.body} />
              </article>
            ))}
          </div>
          <form className="slei-task-thread-composer" onSubmit={submitReply}>
            <textarea
              aria-label={messages.tasks.replyPlaceholder}
              className="slei-textarea"
              onChange={(event) => setReplyDraft(event.currentTarget.value)}
              placeholder={messages.tasks.replyPlaceholder}
              value={replyDraft}
            />
            <button className="slei-button slei-button--accent" type="submit"><Send aria-hidden="true" size={15} />{messages.tasks.sendReply}</button>
          </form>
        </aside>
      ) : null}
    </section>
  );
}

function taskStatusLabel(status: SleiTask["status"], messages: DesktopMessages) {
  return messages.tasks.status[status];
}
