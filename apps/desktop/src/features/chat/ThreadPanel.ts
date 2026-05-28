export function renderThreadPanel(input: {
  channelName: string;
  taskTitle: string;
  replies: Array<{ sender: string; body: string }>;
}): string {
  return [
    `Thread — #${input.channelName}`,
    input.taskTitle,
    ...input.replies.map((reply) => `${reply.sender} ${reply.body}`),
  ].join("\n");
}
