export function renderThreadPanel(input: {
  channelName: string;
  taskTitle: string;
  status?: string;
  replies: Array<{ sender: string; body: string }>;
}): string {
  return [
    `Thread — #${input.channelName}`,
    input.taskTitle,
    input.status ? `Status: ${input.status}` : "",
    ...input.replies.map((reply) => `${reply.sender} ${reply.body}`),
  ]
    .filter(Boolean)
    .join("\n");
}
