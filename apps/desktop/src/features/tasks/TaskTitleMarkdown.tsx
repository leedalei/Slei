import { MarkdownMessage } from "../chat/MarkdownMessage";

export function TaskTitleMarkdown({ markdown }: { markdown: string }) {
  return (
    <MarkdownMessage
      className="slei-task-title-markdown mt-0 gap-1 text-sm font-semibold leading-snug [&_a]:font-semibold [&_li]:ml-3 [&_ol]:pl-3 [&_p]:my-0 [&_p]:font-semibold [&_pre]:my-1 [&_strong]:font-semibold [&_ul]:pl-3"
      codeCopyEnabled={false}
      markdown={markdown}
      tone="card"
    />
  );
}
