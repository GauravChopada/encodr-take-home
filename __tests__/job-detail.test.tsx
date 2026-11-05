import { Suspense } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fetchEventSource, type EventSourceMessage } from "@microsoft/fetch-event-source";
import JobDetailPage from "@/app/(app)/jobs/[id]/page";
import type { EncodeRun, Job, RunEvent } from "@/lib/types";

vi.mock("@microsoft/fetch-event-source", () => ({ fetchEventSource: vi.fn() }));

type Options = Parameters<typeof fetchEventSource>[1];
const fetchMock = vi.fn<typeof fetch>();
const streams: Options[] = [];

const reply = (status: number, body: unknown) => () =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/** Per-path response queues: each call takes the next entry, the last one repeats. */
function serve(routes: Record<string, (() => Response)[]>) {
  fetchMock.mockImplementation(async (path) => {
    const queue = routes[String(path)];
    if (!queue) throw new Error(`unexpected fetch ${String(path)}`);
    return (queue.length > 1 ? queue.shift()! : queue[0])();
  });
}

const job = (over: Partial<Job> = {}): Job => ({
  id: "j_1",
  title: "a.mp4",
  sourceUrl: "https://cdn.example.com/a.mp4",
  status: "RUNNING",
  createdAt: "2026-11-05T00:00:00.000Z",
  latestRunId: "r_1",
  ...over,
});
const activeRun: EncodeRun = { id: "r_1", jobId: "j_1", stage: "QUEUED", progressPct: 0 };
const doneRun: EncodeRun = {
  id: "r_1",
  jobId: "j_1",
  stage: "COMPLETED",
  progressPct: 100,
  result: {
    durationSec: 184,
    renditions: [{ label: "1080p", width: 1920, height: 1080, sizeMb: 412 }],
    warnings: ["Audio track 2 has no language tag"],
  },
};
const frame = (id: number, event: RunEvent): EventSourceMessage => ({ id: String(id), event: "", data: JSON.stringify(event) });

// React's `use()` reads an already-fulfilled thenable synchronously, so the page renders without suspending.
const params = Object.assign(Promise.resolve({ id: "j_1" }), { status: "fulfilled" as const, value: { id: "j_1" } });

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 0 } } });
  return render(
    <QueryClientProvider client={client}>
      <Suspense fallback={<p>suspended</p>}>
        <JobDetailPage params={params} />
      </Suspense>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  fetchMock.mockReset();
  streams.length = 0;
  vi.stubGlobal("fetch", fetchMock);
  vi.mocked(fetchEventSource).mockReset();
  vi.mocked(fetchEventSource).mockImplementation((_url, options) => {
    streams.push(options);
    return new Promise<void>(() => undefined);
  });
});
afterEach(() => vi.unstubAllGlobals());

describe("job detail page: loading errors", () => {
  it("says the job was not found only for a 404", async () => {
    serve({ "/api/jobs/j_1": [reply(404, { detail: "Job not found" })] });
    renderPage();
    expect(await screen.findByText(/Job not found/)).toBeInTheDocument();
  });

  it("offers a retry, not 'not found', when the job request fails for another reason", async () => {
    serve({ "/api/jobs/j_1": [reply(500, { detail: "boom" }), reply(200, job({ latestRunId: undefined }))] });
    renderPage();
    expect(await screen.findByText(/Could not load this job/)).toBeInTheDocument();
    expect(screen.queryByText(/Job not found/)).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("heading", { name: "a.mp4" })).toBeInTheDocument();
  });
});

describe("job detail page: live run", () => {
  it("shows a reconnecting notice when the stream drops and clears it when events resume", async () => {
    serve({ "/api/jobs/j_1": [reply(200, job())], "/api/runs/r_1": [reply(200, activeRun)] });
    renderPage();
    await screen.findByRole("heading", { name: "Progress" });
    const options = streams.at(-1)!;

    act(() => options.onmessage?.(frame(1, { stage: "DOWNLOADING", progressPct: 7, message: "DOWNLOADING 7%" })));
    expect(screen.queryByText(/Reconnecting/)).not.toBeInTheDocument();

    act(() => void options.onerror?.(new Error("network")));
    expect(await screen.findByRole("status")).toHaveTextContent(/Reconnecting/);

    act(() => options.onmessage?.(frame(2, { stage: "DOWNLOADING", progressPct: 10, message: "DOWNLOADING 10%" })));
    expect(screen.queryByText(/Reconnecting/)).not.toBeInTheDocument();
  });

  it("lets the user reload the results when fetching them fails after the run completed", async () => {
    serve({
      "/api/jobs/j_1": [reply(200, job())],
      "/api/runs/r_1": [reply(200, activeRun), reply(500, { detail: "boom" }), reply(200, doneRun)],
    });
    renderPage();
    await screen.findByRole("heading", { name: "Progress" });

    act(() => streams.at(-1)!.onmessage?.(frame(31, { stage: "COMPLETED", progressPct: 100, message: "Encode complete" })));
    expect(await screen.findByText(/Could not load the results/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Reload results" }));
    expect(await screen.findByRole("cell", { name: "1920x1080" })).toBeInTheDocument();
    expect(screen.getByText("Audio track 2 has no language tag")).toBeInTheDocument();
  });
});
