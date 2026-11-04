import {
  clearTokens,
  getAccessToken,
  getRefreshToken,
  setTokens,
} from "@/lib/client/token-store";

export class ApiError extends Error {
  status: number;
  /** Field-level errors from a 422, keyed by form field name. */
  fieldErrors?: Record<string, string[]>;
  constructor(status: number, message: string, fieldErrors?: Record<string, string[]>) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.fieldErrors = fieldErrors;
  }
}

/** Fired when auth is unrecoverable. The auth provider listens for this and logs the user out. */
export const AUTH_LOGOUT_EVENT = "encodr:logout";

async function parseError(res: Response): Promise<ApiError> {
  let detail = res.statusText || "Request failed";
  let fieldErrors: Record<string, string[]> | undefined;
  try {
    const body = await res.json();
    if (body?.detail) detail = body.detail;
    if (body?.fieldErrors) {
      fieldErrors = body.fieldErrors;
      detail = "Validation failed";
    }
  } catch {
    /* non-JSON body */
  }
  return new ApiError(res.status, detail, fieldErrors);
}

let refreshing: Promise<boolean> | null = null;

/**
 * Exchanges the refresh token for a new access token. Concurrent callers share one in-flight call, so
 * N requests that 401 together cause exactly one POST /api/auth/refresh.
 * Resolves false when the session is over (no refresh token, or the server rejected it); a network or
 * server error rejects instead, so a flaky connection does not log the user out.
 */
function refreshOnce(): Promise<boolean> {
  refreshing ??= doRefresh().finally(() => {
    refreshing = null;
  });
  return refreshing;
}

async function doRefresh(): Promise<boolean> {
  const refreshToken = getRefreshToken();
  if (!refreshToken) return false;
  const res = await fetch("/api/auth/refresh", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ refreshToken }),
  });
  if (res.status === 401 || res.status === 403) return false;
  if (!res.ok) throw await parseError(res);
  const { accessToken } = (await res.json()) as { accessToken: string };
  setTokens({ accessToken });
  return true;
}

/**
 * fetch with the bearer token attached. On a 401 (outside /api/auth/*) it refreshes the access token
 * once and retries the request once. If another request already refreshed since this one was sent, it
 * just retries with the current token. If the session cannot be recovered it clears auth and fires
 * AUTH_LOGOUT_EVENT. A 401 on the retry is returned as is, so there is never a loop.
 * Used for JSON calls and for the SSE connection, so both share one refresh path.
 */
export async function authedFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const send = async () => {
    const sentToken = getAccessToken();
    const headers = new Headers(init.headers);
    if (sentToken) headers.set("authorization", `Bearer ${sentToken}`);
    return { res: await fetch(path, { ...init, headers }), sentToken };
  };

  const first = await send();
  if (first.res.status !== 401 || path.startsWith("/api/auth/")) return first.res;

  if (getAccessToken() === first.sentToken) {
    if (!(await refreshOnce())) {
      clearTokens();
      window.dispatchEvent(new Event(AUTH_LOGOUT_EVENT));
      return first.res;
    }
  }
  return (await send()).res;
}

interface RequestOptions {
  method?: string;
  body?: unknown;
  signal?: AbortSignal;
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = {};
  if (options.body !== undefined) headers["content-type"] = "application/json";

  const res = await authedFetch(path, {
    method: options.method ?? "GET",
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    signal: options.signal,
  });

  if (!res.ok) throw await parseError(res);
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const api = {
  get: <T>(path: string, signal?: AbortSignal) => request<T>(path, { signal }),
  post: <T>(path: string, body?: unknown) => request<T>(path, { method: "POST", body }),
};
