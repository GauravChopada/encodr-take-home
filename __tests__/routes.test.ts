// @vitest-environment node
import { beforeEach, describe, expect, it } from "vitest";
import { issueTokens } from "@/lib/server/auth";
import { __resetStore, createJob as storeCreateJob } from "@/lib/server/store";
import { GET as listJobs, POST as createJob } from "@/app/api/jobs/route";
import { GET as getJob } from "@/app/api/jobs/[id]/route";
import { POST as startRun } from "@/app/api/runs/route";
import { GET as getRun } from "@/app/api/runs/[id]/route";
import { GET as runEvents } from "@/app/api/runs/[id]/events/route";

const bearer = () => ({ authorization: `Bearer ${issueTokens("u_demo").accessToken}` });

function req(path: string, init: { method?: string; auth?: boolean; body?: unknown; raw?: string } = {}) {
  return new Request(`http://localhost${path}`, {
    method: init.method ?? "GET",
    headers: { "content-type": "application/json", ...(init.auth === false ? {} : bearer()) },
    body: init.raw ?? (init.body === undefined ? undefined : JSON.stringify(init.body)),
  });
}

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const goodJob = { sourceUrl: "https://cdn.example.com/videos/a.mp4" };

beforeEach(() => __resetStore());

describe("jobs routes", () => {
  it("returns 401 without a token", async () => {
    expect((await listJobs(req("/api/jobs", { auth: false }))).status).toBe(401);
    expect((await createJob(req("/api/jobs", { method: "POST", auth: false, body: goodJob }))).status).toBe(401);
    expect((await getJob(req("/api/jobs/x", { auth: false }), ctx("x"))).status).toBe(401);
  });

  it("returns 422 with a field error for an invalid source URL", async () => {
    const res = await createJob(req("/api/jobs", { method: "POST", body: { sourceUrl: "nope" } }));
    expect(res.status).toBe(422);
    expect((await res.json()).fieldErrors.sourceUrl[0].length).toBeGreaterThan(0);
  });

  it("returns 400 for a body that is not JSON", async () => {
    const res = await createJob(req("/api/jobs", { method: "POST", raw: "not json" }));
    expect(res.status).toBe(400);
  });

  it("creates a NEW job, derives the title when it is whitespace-only, and lists it", async () => {
    const res = await createJob(req("/api/jobs", { method: "POST", body: { ...goodJob, title: "   " } }));
    expect(res.status).toBe(201);
    const job = await res.json();
    expect(job.status).toBe("NEW");
    expect(job.title).toBe("a.mp4");

    const list = await (await listJobs(req("/api/jobs"))).json();
    expect(list.map((j: { id: string }) => j.id)).toContain(job.id);
    const one = await getJob(req(`/api/jobs/${job.id}`), ctx(job.id));
    expect(one.status).toBe(200);
  });

  it("returns 404 for an unknown job", async () => {
    expect((await getJob(req("/api/jobs/missing"), ctx("missing"))).status).toBe(404);
  });
});

describe("runs routes", () => {
  const newJobId = () => storeCreateJob({ sourceUrl: goodJob.sourceUrl }).id;
  const start = (jobId: unknown, auth = true) =>
    startRun(req("/api/runs", { method: "POST", auth, body: { jobId } }));

  it("returns 401 without a token", async () => {
    expect((await start("j", false)).status).toBe(401);
    expect((await getRun(req("/api/runs/x", { auth: false }), ctx("x"))).status).toBe(401);
    expect((await runEvents(req("/api/runs/x/events", { auth: false }), ctx("x"))).status).toBe(401);
  });

  it("returns 404 for an unknown job and 422 for a missing jobId", async () => {
    expect((await start("missing")).status).toBe(404);
    const res = await startRun(req("/api/runs", { method: "POST", body: {} }));
    expect(res.status).toBe(422);
    expect((await res.json()).fieldErrors.jobId).toBeDefined();
  });

  it("starts a run (201) and returns the same run while it is active (200)", async () => {
    const jobId = newJobId();
    const first = await start(jobId);
    expect(first.status).toBe(201);
    const { runId } = await first.json();
    const second = await start(jobId);
    expect(second.status).toBe(200);
    expect((await second.json()).runId).toBe(runId);

    const run = await (await getRun(req(`/api/runs/${runId}`), ctx(runId))).json();
    expect(run.stage).toBe("QUEUED");
  });

  it("returns 404 for an unknown run, including on the events route", async () => {
    expect((await getRun(req("/api/runs/missing"), ctx("missing"))).status).toBe(404);
    const res = await runEvents(req("/api/runs/missing/events"), ctx("missing"));
    expect(res.status).toBe(404);
    expect(res.headers.get("content-type")).toContain("application/json");
  });

  it("streams text/event-stream, treating a junk Last-Event-ID as a fresh connect", async () => {
    const { runId } = await (await start(newJobId())).json();
    const controller = new AbortController();
    const res = await runEvents(
      new Request(`http://localhost/api/runs/${runId}/events`, {
        headers: { ...bearer(), "last-event-id": "abc" },
        signal: controller.signal,
      }),
      ctx(runId),
    );
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    const reader = res.body!.getReader();
    const { value } = await reader.read();
    expect(new TextDecoder().decode(value)).toContain("id: 0");
    controller.abort();
    await reader.cancel();
  });
});
