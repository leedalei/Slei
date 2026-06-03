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

export type MemorySnippet = {
  agentId: string;
  documentPath: string;
  documentSection: string;
  content: string;
};

export type MemorySectionRef = {
  agentId: string;
  documentPath: string;
  documentSection: string;
};

export type ContextMemoryInput = {
  memorySnippets?: readonly MemorySnippet[];
  blockedMemorySections?: readonly MemorySectionRef[];
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
  memory?: ContextMemoryInput,
): ClaudeContextMessage[] {
  const context = records
    .filter((record) => !record.deleted)
    .filter((record) => record.agent_id === scope.agentId)
    .filter((record) => {
      if (scope.taskId) {
        return record.task_id === scope.taskId;
      }
      return record.channel_id === scope.channelId && record.task_id === null;
    })
    .map((record) => ({ role: record.role, content: record.content }));

  const blockedSections = new Set(
    (memory?.blockedMemorySections ?? []).map((section) =>
      memorySectionKey(section),
    ),
  );

  context.push(
    ...(memory?.memorySnippets ?? [])
      .filter((snippet) => snippet.agentId === scope.agentId)
      .filter((snippet) => !blockedSections.has(memorySectionKey(snippet)))
      .map((snippet) => ({
        role: "system" as const,
        content: snippet.content,
      })),
  );

  return context;
}

function memorySectionKey(section: MemorySectionRef): string {
  return `${section.agentId}\u0000${section.documentPath}\u0000${section.documentSection}`;
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
