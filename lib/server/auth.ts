import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { User } from "@/lib/types";

// Mock auth for the exercise: no identity provider, no database.
//
// Tokens are stateless, HMAC-SHA256 signed: base64url(JSON {sub, typ, exp}) + "." + base64url(sig).
// `typ` stops a refresh token being used as an access token (and the reverse). The access token is
// short (60s) so the client's silent-refresh path is exercised constantly.
//
// SSE auth: native EventSource can't send an Authorization header, so the stream is opened with
// @microsoft/fetch-event-source and the same bearer header as every other call (see README).

const ACCESS_TTL_MS = 60_000;
const REFRESH_TTL_MS = 7 * 24 * 60 * 60 * 1000;
// Signing secret: ENCODR_SECRET if set, otherwise a random per-process secret. It is held on globalThis
// so a dev-server reload (HMR) doesn't log everyone out, and no secret is ever hardcoded in source.
// A server restart invalidates tokens, which matches the in-memory store losing its data anyway.
const g = globalThis as typeof globalThis & { __encodrSecret?: string };
g.__encodrSecret ??= process.env.ENCODR_SECRET || randomBytes(32).toString("hex");
const SECRET = g.__encodrSecret;

type TokenType = "access" | "refresh";

// The one hard-coded user. Documented in the README.
const USERS: (User & { password: string })[] = [
  { id: "u_demo", email: "demo@encodr.dev", name: "Demo User", password: "password123" },
];

export function authenticate(email: string, password: string): User | null {
  const user = USERS.find((u) => u.email.toLowerCase() === email.toLowerCase());
  if (!user || user.password !== password) return null;
  const { password: _pw, ...safe } = user;
  return safe;
}

export function findUser(id: string): User | null {
  const user = USERS.find((u) => u.id === id);
  if (!user) return null;
  const { password: _pw, ...safe } = user;
  return safe;
}

function sign(payloadB64: string): Buffer {
  return createHmac("sha256", SECRET).update(payloadB64).digest();
}

function mint(sub: string, typ: TokenType, ttlMs: number, now: number): string {
  const payload = Buffer.from(JSON.stringify({ sub, typ, exp: now + ttlMs })).toString("base64url");
  return `${payload}.${sign(payload).toString("base64url")}`;
}

export function issueTokens(userId: string): { accessToken: string; refreshToken: string } {
  const now = Date.now();
  return {
    accessToken: mint(userId, "access", ACCESS_TTL_MS, now),
    refreshToken: mint(userId, "refresh", REFRESH_TTL_MS, now),
  };
}

export function issueAccessToken(userId: string): string {
  return mint(userId, "access", ACCESS_TTL_MS, Date.now());
}

/** Verify signature, type and expiry; returns the subject (userId) or null. */
export function verifyToken(token: string, typ: TokenType, now: number = Date.now()): string | null {
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [payloadB64, sigB64] = parts;

  const expected = sign(payloadB64);
  const given = Buffer.from(sigB64, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;

  try {
    const claims: unknown = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8"));
    if (typeof claims !== "object" || claims === null) return null;
    const { sub, typ: tokenTyp, exp } = claims as Record<string, unknown>;
    if (typeof sub !== "string" || tokenTyp !== typ) return null;
    if (typeof exp !== "number" || exp <= now) return null;
    return sub;
  } catch {
    return null;
  }
}

/** Return the authenticated userId from the request's bearer token, or null. */
export function getUserIdFromRequest(req: Request): string | null {
  const match = /^Bearer (.+)$/i.exec(req.headers.get("authorization") ?? "");
  return match ? verifyToken(match[1].trim(), "access") : null;
}

/** Verify a refresh token and return its subject (userId), or null. */
export function verifyRefreshToken(token: string): string | null {
  return verifyToken(token, "refresh");
}
