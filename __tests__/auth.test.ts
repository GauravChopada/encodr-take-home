// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  getUserIdFromRequest,
  issueAccessToken,
  issueTokens,
  verifyRefreshToken,
  verifyToken,
} from "@/lib/server/auth";
import { POST as login } from "@/app/api/auth/login/route";
import { POST as refresh } from "@/app/api/auth/refresh/route";

function post(path: string, body: unknown, raw = false): Request {
  return new Request(`http://localhost${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: raw ? (body as string) : JSON.stringify(body),
  });
}

function withHeader(value?: string): Request {
  return new Request("http://localhost/api/jobs", {
    headers: value === undefined ? {} : { authorization: value },
  });
}

describe("tokens", () => {
  it("round-trips an access token to its subject", () => {
    expect(verifyToken(issueTokens("u_demo").accessToken, "access")).toBe("u_demo");
  });

  it("expires the access token at 60s but keeps the refresh token for days", () => {
    const { accessToken, refreshToken } = issueTokens("u_demo");
    const now = Date.now();
    expect(verifyToken(accessToken, "access", now + 59_000)).toBe("u_demo");
    expect(verifyToken(accessToken, "access", now + 61_000)).toBeNull();
    expect(verifyToken(refreshToken, "refresh", now + 6 * 24 * 3600 * 1000)).toBe("u_demo");
  });

  it("rejects a token whose payload or signature was altered", () => {
    const { accessToken } = issueTokens("u_demo");
    const [payload, sig] = accessToken.split(".");
    const flip = (s: string) => (s[0] === "A" ? "B" : "A") + s.slice(1);
    expect(verifyToken(`${flip(payload)}.${sig}`, "access")).toBeNull();
    expect(verifyToken(`${payload}.${flip(sig)}`, "access")).toBeNull();
  });

  it("does not accept a refresh token as an access token, or the reverse", () => {
    const { accessToken, refreshToken } = issueTokens("u_demo");
    expect(verifyToken(refreshToken, "access")).toBeNull();
    expect(verifyToken(accessToken, "refresh")).toBeNull();
    expect(verifyRefreshToken(accessToken)).toBeNull();
    expect(verifyRefreshToken(refreshToken)).toBe("u_demo");
  });
});

describe("getUserIdFromRequest", () => {
  it.each([undefined, "", "Bearer", "Bearer ", "Basic abc", "Bearer a.b", "Bearer not-a-token"])(
    "returns null for authorization header %j",
    (header) => {
      expect(getUserIdFromRequest(withHeader(header))).toBeNull();
    },
  );

  it("returns the user for a valid bearer token", () => {
    const token = issueAccessToken("u_demo");
    expect(getUserIdFromRequest(withHeader(`Bearer ${token}`))).toBe("u_demo");
  });
});

describe("POST /api/auth/login", () => {
  it("returns tokens and the user for valid credentials", async () => {
    const res = await login(post("/api/auth/login", { email: "demo@encodr.dev", password: "password123" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(typeof body.accessToken).toBe("string");
    expect(typeof body.refreshToken).toBe("string");
    expect(body.user.email).toBe("demo@encodr.dev");
  });

  it("returns 401 for a wrong password", async () => {
    const res = await login(post("/api/auth/login", { email: "demo@encodr.dev", password: "nope" }));
    expect(res.status).toBe(401);
  });

  it("returns 422 with field errors when the email is missing", async () => {
    const res = await login(post("/api/auth/login", { password: "x" }));
    expect(res.status).toBe(422);
    expect((await res.json()).fieldErrors.email).toBeDefined();
  });

  it("returns 400 for a body that is not JSON", async () => {
    expect((await login(post("/api/auth/login", "not json", true))).status).toBe(400);
  });
});

describe("POST /api/auth/refresh", () => {
  it("exchanges a refresh token for an access token the API accepts", async () => {
    const { refreshToken } = issueTokens("u_demo");
    const res = await refresh(post("/api/auth/refresh", { refreshToken }));
    expect(res.status).toBe(200);
    const { accessToken } = await res.json();
    expect(getUserIdFromRequest(withHeader(`Bearer ${accessToken}`))).toBe("u_demo");
  });

  it("rejects an access token or garbage in the body with 401", async () => {
    const { accessToken } = issueTokens("u_demo");
    expect((await refresh(post("/api/auth/refresh", { refreshToken: accessToken }))).status).toBe(401);
    expect((await refresh(post("/api/auth/refresh", { refreshToken: "garbage" }))).status).toBe(401);
  });

  it("returns 400 for a body that is not JSON", async () => {
    expect((await refresh(post("/api/auth/refresh", "not json", true))).status).toBe(400);
  });
});
