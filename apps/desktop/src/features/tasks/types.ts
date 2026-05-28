export type TaskStatus = "Todo" | "In Progress" | "In Review" | "Done" | "Closed";

export type TaskView = {
  id: string;
  sequence: number;
  channelName: string;
  creator: string;
  assignee?: string;
  title: string;
  status: TaskStatus;
  attentionRequired: boolean;
};

export type TaskFilters = {
  channel?: string;
  creator?: string;
  assignee?: string;
};

export const TASK_STATUSES: TaskStatus[] = ["Todo", "In Progress", "In Review", "Done", "Closed"];

