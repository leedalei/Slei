export function renderInteractiveCard(input: {
  title: string;
  state: "pending" | "confirmed" | "dismissed" | "rejected";
  action: string;
}): string {
  const stateLabel = {
    pending: "等待确认",
    confirmed: "已确认",
    dismissed: "已忽略",
    rejected: "已拒绝",
  }[input.state];
  return `${input.title} ${input.action} ${stateLabel}`;
}

export function renderInteractiveCardDialog(input: {
  title: string;
  fieldLabel: string;
  value: string;
}): string {
  return `${input.title} ${input.fieldLabel} ${input.value} 确认执行 取消`;
}
