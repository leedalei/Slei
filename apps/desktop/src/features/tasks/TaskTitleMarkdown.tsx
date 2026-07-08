import { MarkdownMessage } from "../chat/MarkdownMessage";

export function TaskTitleMarkdown({ markdown }: { markdown: string }) {
  return (
    <MarkdownMessage
      className="slei-task-title-markdown mt-0 gap-1 text-sm font-normal leading-snug [&_a]:font-normal [&_h1]:font-normal [&_h2]:font-normal [&_li]:ml-3 [&_ol]:pl-3 [&_p]:my-0 [&_p]:font-normal [&_pre]:my-1 [&_strong]:font-normal [&_ul]:pl-3"
      codeCopyEnabled={false}
      markdown={markdown}
      tone="card"
    />
  );
}
