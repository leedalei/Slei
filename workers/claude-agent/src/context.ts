export type ContextRecord = {
  channel_id: string;
  task_id: string | null;
  agent_id: string;
  role: "user" | "assistant" | "system";
  content: string;
  deleted: boolean;
};

export type ContextScope = {
  channelId?: string;
  taskId?: string;
  agentId: string;
};

export type ClaudeContextMessage = {
  role: "user" | "assistant" | "system";
  content: string;
};

export type ClaudeQueryInput = {
  prompt: string;
  cwd: string;
  additionalDirectories?: string[];
  context: ClaudeContextMessage[];
};

export function assembleContext(
  scope: ContextScope,
  records: readonly ContextRecord[],
): ClaudeContextMessage[] {
  return records
    .filter((record) => !record.deleted)
    .filter((record) => record.agent_id === scope.agentId)
    .filter((record) => {
      if (scope.taskId) {
        return record.task_id === scope.taskId;
      }
      return record.channel_id === scope.channelId && record.task_id === null;
    })
    .map((record) => ({ role: record.role, content: record.content }));
}

export function buildClaudeQuery(input: ClaudeQueryInput) {
  return {
    prompt: input.prompt,
    context: input.context,
    options: {
      cwd: input.cwd,
      additionalDirectories: input.additionalDirectories ?? [],
      persistSession: false as const,
    },
  };
}
