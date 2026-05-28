export function renderApprovalEntry(input: {
  taskTitle: string;
  action: string;
  risk: string;
  pending: boolean;
}): string {
  return [
    input.pending ? "等待审批" : "审批已处理",
    input.taskTitle,
    input.action,
    input.risk,
    "允许",
    "拒绝",
  ].join(" ");
}
