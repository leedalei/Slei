export type DaemonHttpMethod = "GET" | "POST" | "PATCH" | "DELETE";

export type DaemonHttpRequestOptions = {
  headers?: Record<string, string>;
};

export type DaemonHttpClient = {
  request<T = unknown>(
    method: DaemonHttpMethod,
    path: string,
    body?: unknown,
    requestOptions?: DaemonHttpRequestOptions,
  ): Promise<T>;
};

export type DaemonHttpClientOptions = {
  endpoint: string;
  token: string;
  fetchImpl?: typeof fetch;
};

export class DesktopDaemonError extends Error {
  readonly code: string;
  readonly status?: number;

  constructor(code: string, message: string, options: { status?: number; cause?: unknown } = {}) {
    super(message);
    this.name = "DesktopDaemonError";
    this.code = code;
    this.status = options.status;
    this.cause = options.cause;
  }
}

export function createDaemonHttpClient(options: DaemonHttpClientOptions): DaemonHttpClient {
  const endpoint = options.endpoint.replace(/\/+$/, "");
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;

  return {
    async request<T = unknown>(
      method: DaemonHttpMethod,
      path: string,
      body?: unknown,
      requestOptions: DaemonHttpRequestOptions = {},
    ): Promise<T> {
      const url = `${endpoint}${normalizePath(path)}`;
      const headers = requestHeadersWithoutAuthorization(requestOptions.headers);

      if (body !== undefined) {
        headers["Content-Type"] = "application/json";
      }

      headers.Authorization = `Bearer ${options.token}`;

      const init: RequestInit = { method, headers };
      if (body !== undefined) {
        init.body = JSON.stringify(body);
      }

      let response: Response;
      try {
        response = await fetchImpl(url, init);
      } catch (error) {
        throw new DesktopDaemonError("daemon_unavailable", `Daemon request failed: ${method} ${path}`, {
          cause: error,
        });
      }

      if (response.status === 401) {
        throw new DesktopDaemonError("daemon_auth_failed", `Daemon authorization failed: ${method} ${path}`, {
          status: response.status,
        });
      }

      if (!response.ok) {
        throw new DesktopDaemonError("daemon_http_error", `Daemon request returned HTTP ${response.status}: ${method} ${path}`, {
          status: response.status,
        });
      }

      return parseDaemonJson<T>(response);
    },
  };
}

function requestHeadersWithoutAuthorization(input: Record<string, string> | undefined): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(input ?? {})) {
    if (key.toLowerCase() !== "authorization") {
      headers[key] = value;
    }
  }
  return headers;
}

function normalizePath(path: string): string {
  return path.startsWith("/") ? path : `/${path}`;
}

async function parseDaemonJson<T>(response: Response): Promise<T> {
  if (response.status === 204) {
    return undefined as T;
  }

  try {
    return (await response.json()) as T;
  } catch (error) {
    throw new DesktopDaemonError("daemon_http_error", "Daemon response was not valid JSON", {
      status: response.status,
      cause: error,
    });
  }
}
