export type TaskStatus = "pending_assignment" | "in_progress" | "in_review" | "done";

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

export const TASK_STATUSES: TaskStatus[] = ["pending_assignment", "in_progress", "in_review", "done"];
