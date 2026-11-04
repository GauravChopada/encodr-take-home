import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AUTH_LOGOUT_EVENT, ApiError, api } from "@/lib/client/api";
import { clearTokens, getAccessToken, getRefreshToken, setTokens } from "@/lib/client/token-store";

const fetchMock = vi.fn<typeof fetch>();
const respond = (status: number, body: unknown = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const authOf = (init?: RequestInit) => new Headers(init?.headers).get("authorization");
const callsTo = (path: string) => fetchMock.mock.calls.filter(([p]) => p === path);

/** A fake API: refresh hands out T2 (after a beat, so concurrent callers overlap); other paths accept only T2. */
function defaultServer(path: string | URL | Request, init?: RequestInit): Promise<Response> {
  if (path === "/api/auth/refresh") {
    return new Promise((r) => setTimeout(() => r(respond(200, { accessToken: "T2" })), 10));
  }
  return Promise.resolve(authOf(init) === "Bearer T2" ? respond(200, { ok: true }) : respond(401, { detail: "no" }));
}

let logouts = 0;
const onLogout = () => (logouts += 1);

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockImplementation(defaultServer);
  vi.stubGlobal("fetch", fetchMock);
  clearTokens();
  setTokens({ accessToken: "T1", refreshToken: "R1" });
  logouts = 0;
  window.addEventListener(AUTH_LOGOUT_EVENT, onLogout);
});
afterEach(() => {
  window.removeEventListener(AUTH_LOGOUT_EVENT, onLogout);
  vi.unstubAllGlobals();
});

describe("silent refresh", () => {
  it("shares one refresh between concurrent 401s and retries each request once with the new token", async () => {
    await Promise.all([api.get("/api/a"), api.get("/api/b"), api.get("/api/c")]);
    expect(callsTo("/api/auth/refresh")).toHaveLength(1);
    for (const path of ["/api/a", "/api/b", "/api/c"]) {
      expect(callsTo(path).map(([, init]) => authOf(init))).toEqual(["Bearer T1", "Bearer T2"]);
    }
    expect(getAccessToken()).toBe("T2");
  });

  it("retries a request that was sent with a stale token without refreshing again", async () => {
    let release: (r: Response) => void = () => undefined;
    fetchMock.mockImplementation((path, init) =>
      path === "/api/slow" && authOf(init) === "Bearer T1"
        ? new Promise<Response>((r) => (release = r))
        : defaultServer(path, init),
    );
    const slow = api.get("/api/slow");
    await api.get("/api/a"); // refreshes T1 -> T2 while /api/slow is still in flight
    release(respond(401));
    await expect(slow).resolves.toEqual({ ok: true });
    expect(callsTo("/api/auth/refresh")).toHaveLength(1);
  });

  it("does not loop when the retry is rejected too", async () => {
    fetchMock.mockImplementation((path, init) =>
      path === "/api/always401" ? Promise.resolve(respond(401, { detail: "nope" })) : defaultServer(path, init),
    );
    await expect(api.get("/api/always401")).rejects.toMatchObject({ status: 401 });
    expect(callsTo("/api/always401")).toHaveLength(2);
    expect(callsTo("/api/auth/refresh")).toHaveLength(1);
  });

  it("clears tokens and signals logout when the refresh token is rejected", async () => {
    fetchMock.mockImplementation((path, init) =>
      path === "/api/auth/refresh" ? Promise.resolve(respond(401)) : defaultServer(path, init),
    );
    const err = await api.get("/api/a").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(401);
    expect(getAccessToken()).toBeNull();
    expect(getRefreshToken()).toBeNull();
    expect(logouts).toBe(1);
  });

  it("keeps the session when the refresh call fails with a network error", async () => {
    fetchMock.mockImplementation((path, init) =>
      path === "/api/auth/refresh" ? Promise.reject(new TypeError("Failed to fetch")) : defaultServer(path, init),
    );
    await expect(api.get("/api/a")).rejects.toBeInstanceOf(TypeError);
    expect(getRefreshToken()).toBe("R1");
    expect(logouts).toBe(0);
  });

  it("does not try to refresh when a login attempt returns 401", async () => {
    fetchMock.mockImplementation(() => Promise.resolve(respond(401, { detail: "Invalid email or password" })));
    await expect(api.post("/api/auth/login", { email: "a", password: "b" })).rejects.toMatchObject({
      status: 401,
      message: "Invalid email or password",
    });
    expect(callsTo("/api/auth/refresh")).toHaveLength(0);
    expect(logouts).toBe(0);
  });
});
