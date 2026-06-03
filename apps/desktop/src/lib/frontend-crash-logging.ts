import { invoke } from "@tauri-apps/api/core";

export type FrontendCrashKind = "react" | "window-error" | "unhandled-rejection";

export type FrontendCrashReport = {
  kind: FrontendCrashKind;
  message: string;
  stack?: string;
  componentStack?: string;
  url: string;
};

function stringifyError(value: unknown): { message: string; stack?: string } {
  if (value instanceof Error) return { message: value.message, stack: value.stack };
  if (typeof value === "string") return { message: value };
  try {
    return { message: JSON.stringify(value) ?? String(value) };
  } catch {
    return { message: String(value) };
  }
}

function sanitizeCrashText(value: string): string {
  return value
    .replace(/token=([^\s&]+)/gi, "token=[redacted-token]")
    .replace(/bearer\s+[a-z0-9._-]+/gi, "Bearer [redacted-token]")
    .slice(0, 4000);
}

export function createFrontendCrashReport(
  kind: FrontendCrashKind,
  error: unknown,
  componentStack?: string,
): FrontendCrashReport {
  const normalized = stringifyError(error);
  return {
    kind,
    message: sanitizeCrashText(normalized.message || "Unknown frontend crash"),
    stack: normalized.stack ? sanitizeCrashText(normalized.stack) : undefined,
    componentStack: componentStack ? sanitizeCrashText(componentStack) : undefined,
    url: typeof window === "undefined" ? "" : window.location.href,
  };
}

export function logFrontendCrash(report: FrontendCrashReport) {
  console.error("[slei-frontend-crash]", report);
  void invoke("log_frontend_crash_command", { report }).catch((error) => {
    console.error("[slei-frontend-crash] failed to send crash report", error);
  });
}

export function reportFrontendCrash(
  kind: FrontendCrashKind,
  error: unknown,
  componentStack?: string,
) {
  logFrontendCrash(createFrontendCrashReport(kind, error, componentStack));
}

export function installFrontendCrashLogging() {
  window.addEventListener("error", (event) => {
    reportFrontendCrash("window-error", event.error ?? event.message);
  });
  window.addEventListener("unhandledrejection", (event) => {
    reportFrontendCrash("unhandled-rejection", event.reason);
  });
}
