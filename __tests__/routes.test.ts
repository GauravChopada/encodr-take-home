// @vitest-environment node
import { beforeEach, describe, expect, it } from "vitest";
import { issueTokens } from "@/lib/server/auth";
import { __resetStore } from "@/lib/server/store";
import { GET as listJobs, POST as createJob } from "@/app/api/jobs/route";
import { GET as getJob } from "@/app/api/jobs/[id]/route";

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
