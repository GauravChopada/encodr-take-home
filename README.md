# Encodr: Fullstack Take-Home

A small media-transcoding dashboard. A signed-in user creates an encode **job** from a media URL,
starts a **run**, watches its progress stream in live over SSE, and sees the output **renditions**
(or a clear error with a retry). The full brief is in `BRIEF.md`.

## Run it

```bash
npm install
npm run dev        # http://localhost:3000
npm run test:run   # 90 tests, Vitest + React Testing Library
npm run typecheck  # tsc --noEmit (strict)
npm run build      # production build
```

Requires **Node 20+**. **Login:** `demo@encodr.dev` / `password123`.

To see the error path, create a job from `https://cdn.example.com/videos/corrupt.mp4`: it fails about
20 seconds in, shows the error, and **Retry** starts a new run. Any other `http(s)` URL ending in a media
extension (e.g. `https://cdn.example.com/videos/sample.mp4`) completes in about 31 seconds.

Optional: set `ENCODR_SECRET` to fix the token-signing secret. Without it a random per-process secret is
generated (so there is nothing to configure, and restarting the server signs everyone out, just as it
empties the in-memory store).

## How it is built

```
lib/types.ts            shared contract; EncodeRun is a discriminated union on `stage`
lib/schemas.ts          Zod schemas shared by client forms and route handlers
lib/server/store.ts     in-memory store + the run state machine (computeRun, eventAt, lastTick)
lib/server/auth.ts      HMAC-signed access/refresh tokens
lib/server/sse.ts       the resumable SSE stream (kept out of the route file so it is testable)
app/api/**              thin route handlers
lib/client/api.ts       authedFetch: bearer token, single-flight refresh, one retry
lib/client/use-run-stream.ts   the SSE hook + a pure reducer
```

### The run is a state machine that is a pure function of time

`computeRun(record, now)` derives `{ stage, progressPct, error?, result? }` from `now - startedAt`
(QUEUED 0-2s, DOWNLOADING 2-8s, PROBING 8-11s, TRANSCODING 11-27s, PACKAGING 27-31s, then COMPLETED;
`corrupt.mp4` becomes FAILED at 20.6s). Nothing ticks on the server, so it is trivially unit-testable and
the SSE stream is resumable (below). `EncodeRun` is a union on `stage`, so a result on a FAILED run, or a
missing error, does not type-check. The JSON on the wire is unchanged from the contract.

A job's `status` is derived from its latest run on every read and never stored, so the jobs list cannot
drift from the run. When the stream reports a terminal stage the client invalidates the jobs queries.

### How the SSE stream is authenticated

The client opens the stream with **`@microsoft/fetch-event-source` and the normal `Authorization: Bearer`
header**, going through the same `authedFetch` as every other request.

Why this over the alternatives:

- **Query-param token** (works with native `EventSource`): needs an extra endpoint to mint a short-lived
  per-run token, and puts a credential in a URL that proxies and access logs record.
- **HttpOnly cookie**: works natively, but it is a second auth mechanism next to the bearer tokens, and it
  brings CSRF into the picture.
- **Header** (chosen): one verifier on the server for every route, no token in a URL, and the stream reuses
  the refresh logic for free.

The access token only needs to be valid when the connection opens, so its 60s expiry mid-stream is
harmless. Details that matter (from reading the library source):

- `openWhenHidden: true`. By default the library aborts and reopens the stream when the tab visibility
  changes.
- A custom `fetch` option that calls `authedFetch`, so every (re)connect attaches the *current* token and
  can refresh it. Passing a static `headers` object would reuse an expired token on retry.
- The library only retries when `onclose`/`onerror` throw. A close before a terminal event throws (so it
  reconnects); after COMPLETED/FAILED the hook aborts the connection itself.

### Resume after a disconnect (stretch)

Each SSE event is a pure function of a **tick number** (one per second since the run started) and is sent
with `id: <tick>`. A connection starts at `Last-Event-ID + 1` (or tick 0), replays any ticks already due,
then continues live. A page reload mid-run and a reconnect after a dropped connection are the same code
path, the log rebuilds, and the client ignores ids it has already applied (so React StrictMode's double
effect cannot duplicate lines).

### How refresh and retry work (stretch: no refresh stampede)

All JSON calls and the SSE connection go through `authedFetch`:

1. Attach the access token. If the response is not 401, return it.
2. On a 401 (not for `/api/auth/*`): if another request has already replaced the token since this one was
   sent, just retry with the current token. Otherwise call `refreshOnce()`.
3. `refreshOnce()` shares **one in-flight promise**, so N requests that 401 together cause exactly one
   `POST /api/auth/refresh`.
4. Retry the original request **once**. A second 401 is returned as an error, so there are no loops.
5. If the refresh token is rejected (401/403), clear tokens and fire `AUTH_LOGOUT_EVENT`, which redirects
   to `/signin`. A network error during refresh does **not** log the user out.

Tokens are `base64url(payload).base64url(HMAC-SHA256)` with `{ sub, typ, exp }`; `typ` stops a refresh token
being used as an access token. Access tokens last 60s so the refresh path is exercised constantly.

## Tests: strategy

Ninety tests over a handful of files, aimed at the logic most likely to break:

| File | What it pins |
|---|---|
| `run-machine.test.ts` | stage boundaries, monotonic progress, failure timing, derived job status, idempotent start, the union type |
| `api-refresh.test.ts` | one refresh for concurrent 401s, stale-token retry, no loop, logout rules, login 401 does not refresh |
| `auth.test.ts` | token round trip, expiry, tampering, token-type confusion, malformed headers, login/refresh routes |
| `routes.test.ts`, `schemas.test.ts` | 401/404/400/422 behaviour, field errors, whitespace, URL rules |
| `sse.test.ts` | replay, resume from `Last-Event-ID`, close on terminal, timers cleared on abort and cancel |
| `run-stream.test.tsx` | the reducer, and the hook: updates, terminal abort, reconnect rules, unmount and run-id change |
| `create-job-form.test.tsx` | client validation, server 422 mapped onto the field, success payload |

Not tested on purpose: styling, the job-detail page as a whole (I verified it by hand in the browser: live
progress, results, the failure and retry path, reload mid-run, navigating away, expired and invalid
tokens), and the API surface beyond the contract.

## Assumptions

- One hard-coded user; state is in memory on `globalThis` (survives dev-server hot reloads, lost on restart).
- A source URL must be http(s), have a dotted host, a non-empty path, and a media extension (mp4, mov, m4v,
  mkv, webm, avi, m3u8, mpd). The extension allowlist is my reading of "media URL".
- Starting a run on a job that already has an active run returns that run (`200`, vs `201` for a new one), so
  a double-click cannot start two. Retry and "Run again" create a new run; `latestRunId` moves to it.
- The page watches `job.latestRunId` (server data), so reloads and navigation resume the right run.
- Tokens live in `localStorage` (as in the scaffold), so the dashboard guard is client-side. With cookies a
  server-side redirect would be possible.

## What I would do next

- Refresh-token rotation and revocation (the refresh token is currently stateless and reusable until expiry).
- Move tokens to HttpOnly cookies and guard the dashboard on the server.
- Optimistic create with rollback, and a Playwright happy-path test.
- A real store (the state-machine inputs would become persisted timestamps) and a real worker.
