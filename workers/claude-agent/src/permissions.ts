import { randomUUID } from "node:crypto";
import { dirname } from "node:path";
import { existsSync, realpathSync } from "node:fs";

import { createSleiToolAliases, SLEI_PRODUCT_TOOL_NAMES, toSleiMcpToolName } from "./slei-tools.js";

export type PermissionPreset = "ReadOnly" | "Edit" | "Controlled";
export type PermissionResolutionDecision = "approve_once" | "approve_session" | "deny" | "approve";

type PermissionResult =
  | {
      behavior: "allow";
      toolUseID?: string;
      decisionClassification?: "user_temporary" | "user_permanent";
    }
  | {
      behavior: "deny";
      message: string;
      interrupt?: boolean;
      toolUseID?: string;
      decisionClassification?: "user_reject";
    };

type CanUseToolOptions = {
  signal: AbortSignal;
  toolUseID: string;
  blockedPath?: string;
  title?: string;
  displayName?: string;
  description?: string;
};

export type IsolatedSdkOptions = {
  persistSession: false;
  permissionMode: "default" | "acceptEdits" | "plan";
  tools: string[];
  allowedTools: string[];
  disallowedTools: string[];
  settingSources: string[];
  skills: "all";
  toolAliases: Record<string, string>;
  canUseTool: (
    toolName: string,
    input: Record<string, unknown>,
    options: CanUseToolOptions,
  ) => Promise<PermissionResult>;
  cwd: string;
};

export type CanUseToolCall = {
  requestId: string;
  runId: string;
  toolUseId: string;
  agentId: string;
  toolName: string;
  input: Record<string, unknown>;
};

export type RunPermissionController = {
  canUseTool(
    toolName: string,
    input: Record<string, unknown>,
    options: CanUseToolOptions,
  ): Promise<PermissionResult>;
  nextPermissionRequest(): Promise<PermissionRequestEvent>;
  drainPermissionRequests(): PermissionRequestEvent[];
  resolvePermission(input: { requestId: string; decision: PermissionResolutionDecision }): boolean;
};

export type PermissionRequestEvent = {
  type: "permission_request";
  requestId: string;
  runId: string;
  toolUseId: string;
  agentId: string;
  toolName: string;
  risk: "read_only" | "controlled" | "dangerous";
  input: Record<string, unknown>;
  targetPath?: string;
  sessionId: string;
};

export type RunPermissionControllerInput = {
  runId: string;
  agentId: string;
  cwd: string;
  allowedDirectories?: readonly string[];
  sessionId: string;
};

const READ_TOOLS = ["Skill", "Read", "Grep", "Glob", "LS"] as const;
const WRITE_TOOLS = ["Write", "Edit", "MultiEdit"] as const;
const BUILTIN_TOOLS = [...READ_TOOLS, ...WRITE_TOOLS];
const sessionGrants = new Set<string>();

export function buildIsolatedSdkOptions(
  preset: PermissionPreset,
  cwd: string,
  controller = createRunPermissionController({
    runId: "unknown",
    agentId: "unknown",
    cwd,
    sessionId: "unknown",
  }),
): IsolatedSdkOptions {
  return {
    persistSession: false,
    permissionMode: preset === "ReadOnly" ? "plan" : "default",
    tools: [...BUILTIN_TOOLS],
    allowedTools: [...READ_TOOLS, ...SLEI_PRODUCT_TOOL_NAMES.map(toSleiMcpToolName)],
    disallowedTools: ["Task", "Plugin:*", "Bash:curl", "Bash:wget"],
    settingSources: ["user", "project", "local"],
    skills: "all",
    toolAliases: createSleiToolAliases(),
    canUseTool: controller.canUseTool,
    cwd,
  };
}

export function createRunPermissionController(input: RunPermissionControllerInput): RunPermissionController {
  const pending = new Map<string, (result: PermissionResult) => void>();
  const queue = createAsyncQueue<PermissionRequestEvent>();
  const allowedDirectories = uniquePaths([input.cwd, ...(input.allowedDirectories ?? [])]);

  function canUseTool(
    toolName: string,
    toolInput: Record<string, unknown>,
    options: CanUseToolOptions,
  ): Promise<PermissionResult> {
    if (isReadTool(toolName)) {
      return Promise.resolve({ behavior: "allow", toolUseID: options.toolUseID });
    }

    if (!isWriteTool(toolName)) {
      return Promise.resolve({
        behavior: "deny",
        message: `${toolName} is not allowed by Slei's current session policy.`,
        toolUseID: options.toolUseID,
        decisionClassification: "user_reject",
      });
    }

    const targetPath = toolTargetPath(toolInput, options);
    if (targetPath && isInsideAnyWorkspace(targetPath, input.cwd, allowedDirectories)) {
      return Promise.resolve({ behavior: "allow", toolUseID: options.toolUseID });
    }

    const grantKey = sessionGrantKey(input.sessionId, input.agentId, toolName, targetPath);
    if (targetPath && sessionGrants.has(grantKey)) {
      return Promise.resolve({
        behavior: "allow",
        toolUseID: options.toolUseID,
        decisionClassification: "user_permanent",
      });
    }

    const requestId = `perm_${randomUUID().replaceAll("-", "")}`;
    const request: PermissionRequestEvent = {
      type: "permission_request",
      requestId,
      runId: input.runId,
      toolUseId: options.toolUseID,
      agentId: input.agentId,
      toolName,
      risk: riskForTool(toolName),
      input: toolInput,
      targetPath,
      sessionId: input.sessionId,
    };
    queue.push(request);

    return new Promise((resolve) => {
      pending.set(requestId, (result) => {
        const withToolUseId = { ...result, toolUseID: options.toolUseID };
        if (withToolUseId.behavior === "allow" && withToolUseId.decisionClassification === "user_permanent" && targetPath) {
          sessionGrants.add(grantKey);
        }
        resolve(withToolUseId);
      });
      options.signal.addEventListener(
        "abort",
        () => {
          pending.delete(requestId);
          resolve({
            behavior: "deny",
            message: "Permission request was cancelled.",
            toolUseID: options.toolUseID,
            decisionClassification: "user_reject",
          });
        },
        { once: true },
      );
    });
  }

  function resolvePermission(resolution: { requestId: string; decision: PermissionResolutionDecision }): boolean {
    const resolver = pending.get(resolution.requestId);
    if (!resolver) {
      return false;
    }
    pending.delete(resolution.requestId);
    if (resolution.decision === "deny") {
      resolver({
        behavior: "deny",
        message: "Denied by user.",
        decisionClassification: "user_reject",
      });
    } else {
      resolver({
        behavior: "allow",
        decisionClassification: resolution.decision === "approve_session" ? "user_permanent" : "user_temporary",
      });
    }
    return true;
  }

  return {
    canUseTool,
    nextPermissionRequest: queue.next,
    drainPermissionRequests: queue.drain,
    resolvePermission,
  };
}

export function toPermissionRequest(call: CanUseToolCall) {
  return {
    type: "permission_requested" as const,
    request_id: call.requestId,
    run_id: call.runId,
    tool_use_id: call.toolUseId,
    agent_id: call.agentId,
    tool_name: call.toolName,
    risk: riskForTool(call.toolName),
    input: call.input,
  };
}

function riskForTool(toolName: string): "read_only" | "controlled" | "dangerous" {
  if (isReadTool(toolName)) {
    return "read_only";
  }
  if (toolName === "Bash" || toolName === "Delete") {
    return "dangerous";
  }
  return "controlled";
}

function isReadTool(toolName: string): boolean {
  return READ_TOOLS.includes(toolName as (typeof READ_TOOLS)[number]);
}

function isWriteTool(toolName: string): boolean {
  return WRITE_TOOLS.includes(toolName as (typeof WRITE_TOOLS)[number]);
}

function toolTargetPath(input: Record<string, unknown>, options: CanUseToolOptions): string | undefined {
  for (const key of ["file_path", "path"]) {
    const value = input[key];
    if (typeof value === "string" && value.trim()) {
      return value;
    }
  }
  return options.blockedPath;
}

function isInsideAnyWorkspace(targetPath: string, cwd: string, allowedDirectories: readonly string[]): boolean {
  return allowedDirectories.some((directory) => isInsideWorkspace(targetPath, cwd, directory));
}

function isInsideWorkspace(targetPath: string, cwd: string, allowedDirectory: string): boolean {
  const normalizedCwd = normalizePath(cwd);
  const normalizedAllowed = normalizePath(allowedDirectory);
  const normalizedTarget = normalizePath(targetPath.startsWith("/") ? targetPath : `${cwd}/${targetPath}`);
  if (normalizedTarget === normalizedAllowed || normalizedTarget.startsWith(`${normalizedAllowed}/`)) {
    return true;
  }
  const realTarget = realpathForPermission(normalizedTarget);
  const realAllowed = realpathForPermission(normalizedAllowed);
  return realTarget === realAllowed || realTarget.startsWith(`${realAllowed}/`) || normalizedTarget === normalizedCwd;
}

function normalizePath(path: string): string {
  const absolute = path.startsWith("/") ? path : `/${path}`;
  const parts: string[] = [];
  for (const part of absolute.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") {
      parts.pop();
    } else {
      parts.push(part);
    }
  }
  return `/${parts.join("/")}`;
}

function sessionGrantKey(sessionId: string, agentId: string, toolName: string, targetPath: string | undefined): string {
  return [sessionId, agentId, toolName, targetPath ? normalizePath(targetPath) : "*"].join("\0");
}

function uniquePaths(paths: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const path of paths) {
    const normalized = realpathForPermission(normalizePath(path));
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
}

function realpathForPermission(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    const parent = dirname(path);
    if (parent !== path && existsSync(parent)) {
      try {
        return normalizePath(`${realpathSync(parent)}/${path.split("/").at(-1) ?? ""}`);
      } catch {
        return normalizePath(path);
      }
    }
    return normalizePath(path);
  }
}

function createAsyncQueue<T>() {
  const values: T[] = [];
  const waiters: Array<(value: T) => void> = [];
  return {
    push(value: T) {
      const waiter = waiters.shift();
      if (waiter) {
        waiter(value);
      } else {
        values.push(value);
      }
    },
    next(): Promise<T> {
      const value = values.shift();
      if (value) {
        return Promise.resolve(value);
      }
      return new Promise((resolve) => waiters.push(resolve));
    },
    drain(): T[] {
      return values.splice(0, values.length);
    },
  };
}
