export type RuntimeKind = "ClaudeCode";

export type WorkerCommand =
  | HelloCommand
  | StartRunCommand
  | ClearSessionCommand
  | CancelCommand
  | ResolvePermissionCommand
  | ResolveHumanQuestionCommand;

export type HelloCommand = {
  type: "hello";
  protocol_version: "v1";
  launch_secret: string;
};

export type StartRunCommand = {
  type: "start_run";
  run_id: string;
  session: RuntimeSession;
  input: RunInput;
};

export type ClearSessionCommand = {
  type: "clear_session";
  session: RuntimeSession;
};

export type CancelCommand = {
  type: "cancel";
  run_id: string;
};

export type ResolvePermissionCommand = {
  type: "resolve_permission";
  request_id: string;
  decision: "approve" | "deny";
};

export type ResolveHumanQuestionCommand = {
  type: "resolve_human_question";
  request_id: string;
  answer: string;
};

export type RuntimeSession = {
  session_id: string;
  agent_id: string;
  runtime: RuntimeKind;
  cwd: string;
  model?: string;
  persist_session: boolean;
  resume_session: boolean;
};

export type RunInput = {
  prompt: string;
  context: Array<{ role: "user" | "assistant" | "system"; content: string }>;
};

export type WorkerEvent =
  | OutputDeltaEvent
  | ToolStartedEvent
  | PermissionRequestedEvent
  | HumanQuestionRequestedEvent
  | ProductToolRequestedEvent
  | ToolCompletedEvent
  | CompletedEvent
  | FailedEvent;

export type OutputDeltaEvent = {
  type: "output_delta";
  run_id: string;
  delta: string;
};

export type ToolStartedEvent = {
  type: "tool_started";
  run_id: string;
  tool_use_id: string;
  name: string;
};

export type PermissionRequestedEvent = {
  type: "permission_requested";
  request_id: string;
  run_id: string;
  tool_use_id: string;
  agent_id: string;
  tool_name: string;
  risk: "read_only" | "controlled" | "dangerous";
};

export type HumanQuestionRequestedEvent = {
  type: "human_question_requested";
  request_id: string;
  run_id: string;
  agent_id: string;
  question: string;
};

export type ProductToolRequestedEvent = {
  type: "product_tool_requested";
  run_id: string;
  tool_use_id: string;
  agent_id: string;
  tool_name:
    | "slei_propose_interactive_card"
    | "slei_request_visible_delegation"
    | "slei_request_human_reply";
  payload: Record<string, unknown>;
};

export type ToolCompletedEvent = {
  type: "tool_completed";
  run_id: string;
  tool_use_id: string;
  ok: boolean;
};

export type CompletedEvent = {
  type: "completed";
  run_id: string;
};

export type FailedEvent = {
  type: "failed";
  run_id: string;
  message: string;
};
