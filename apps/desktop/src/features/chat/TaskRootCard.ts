export function renderTaskRootCard(input: {
  title: string;
  status: string;
  replyCount: number;
  unread: boolean;
  assignee?: string;
}): string {
  return [
    input.title,
    input.status,
    `${input.replyCount} replies`,
    input.unread ? "unread" : "",
    input.assignee ?? "",
  ]
    .filter(Boolean)
    .join(" ");
}
