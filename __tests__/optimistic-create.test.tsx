import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, renderHook, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import JobsPage from "@/app/(app)/jobs/page";
import { isOptimisticJob, useCreateJob, useJobs } from "@/lib/client/hooks";
import type { Job } from "@/lib/types";

const fetchMock = vi.fn<typeof fetch>();
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const job = (id: string, title: string): Job => ({
  id,
  title,
  sourceUrl: `https://cdn.example.com/${title}`,
  status: "NEW",
  createdAt: "2026-11-05T00:00:00.000Z",
});

const input = { sourceUrl: "https://cdn.example.com/videos/clip.mp4", title: "My clip" };

/** Controls when the POST /api/jobs response arrives, so the optimistic window can be observed. */
function serveJobs(opts: { lists: Job[][]; post: () => Response }) {
  let release: () => void = () => undefined;
  const gate = new Promise<void>((r) => (release = r));
  const lists = [...opts.lists];
  fetchMock.mockImplementation(async (path, init) => {
    if (path === "/api/jobs" && init?.method === "POST") {
      await gate;
      return opts.post();
    }
    return json(200, lists.length > 1 ? lists.shift() : lists[0]);
  });
  return release;
}

function wrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 30_000 } } });
  return ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe("optimistic create", () => {
  it("shows the new job immediately, then swaps in the server's job", async () => {
    const release = serveJobs({
      lists: [[job("j_old", "old.mp4")], [job("j_new", "My clip"), job("j_old", "old.mp4")]],
      post: () => json(201, job("j_new", "My clip")),
    });
    const { result } = renderHook(() => ({ jobs: useJobs(), create: useCreateJob() }), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.jobs.data).toHaveLength(1));

    act(() => result.current.create.mutate(input));
    await waitFor(() => expect(result.current.jobs.data).toHaveLength(2));
    const [first, second] = result.current.jobs.data!;
    expect(isOptimisticJob(first)).toBe(true);
    expect(first.title).toBe("My clip");
    expect(second.id).toBe("j_old");

    release();
    await waitFor(() => expect(result.current.jobs.data?.map((j) => j.id)).toEqual(["j_new", "j_old"]));
    expect(result.current.jobs.data?.some(isOptimisticJob)).toBe(false);
  });

  it("titles an untitled optimistic job the way the server will, so the row does not change text on confirm", async () => {
    const release = serveJobs({ lists: [[]], post: () => json(201, job("j_new", "clip.mp4")) });
    const { result } = renderHook(() => ({ jobs: useJobs(), create: useCreateJob() }), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.jobs.isSuccess).toBe(true));

    act(() => result.current.create.mutate({ sourceUrl: input.sourceUrl, title: "" }));
    await waitFor(() => expect(result.current.jobs.data).toHaveLength(1));
    expect(result.current.jobs.data![0].title).toBe("clip.mp4");
    release();
  });

  it("rolls back only the optimistic job when the server rejects it", async () => {
    const release = serveJobs({
      lists: [[job("j_old", "old.mp4")]],
      post: () => json(422, { detail: "Validation failed", fieldErrors: { sourceUrl: ["Host is not allowed"] } }),
    });
    const { result } = renderHook(() => ({ jobs: useJobs(), create: useCreateJob() }), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.jobs.data).toHaveLength(1));

    act(() => result.current.create.mutate(input));
    await waitFor(() => expect(result.current.jobs.data).toHaveLength(2));

    release();
    await waitFor(() => expect(result.current.create.isError).toBe(true));
    await waitFor(() => expect(result.current.jobs.data?.map((j) => j.id)).toEqual(["j_old"]));
  });
});

describe("jobs page while a create is pending", () => {
  it("lists the pending job as 'Creating...' without a link to a detail page that does not exist yet", async () => {
    const release = serveJobs({ lists: [[]], post: () => json(201, job("j_new", "My clip")) });
    render(<JobsPage />, { wrapper: wrapper() });
    await screen.findByText("No jobs yet.");

    await userEvent.type(screen.getByLabelText("Source URL"), input.sourceUrl);
    await userEvent.type(screen.getByLabelText("Title (optional)"), input.title);
    await userEvent.click(screen.getByRole("button", { name: /Create job|Creating/ }));

    expect(await screen.findByText("Creating...", { selector: "span" })).toBeInTheDocument();
    expect(screen.getByText("My clip")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /My clip/ })).not.toBeInTheDocument();
    release();
  });
});
