export function renderDelegationEntry(input: {
  from: string;
  to: string;
  taskTitle: string;
  pending: boolean;
}): string {
  return [
    `${input.from} → ${input.to}`,
    input.taskTitle,
    input.pending ? "等待回复" : "已流转",
    "停止后续运行",
  ].join(" ");
}
