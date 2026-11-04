import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useJobs } from "@/lib/client/hooks";
import type { Job } from "@/lib/types";

const fetchMock = vi.fn<typeof fetch>();
const job = (status: Job["status"]): Job => ({
  id: "j_1",
  title: "a.mp4",
  sourceUrl: "https://cdn.example.com/a.mp4",
  status,
  createdAt: "2026-11-04T00:00:00.000Z",
});
const advance = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));
const reply = (jobs: Job[]) =>
  Promise.resolve(new Response(JSON.stringify(jobs), { status: 200, headers: { "content-type": "application/json" } }));

function renderJobs() {
  const client = new QueryClient({ defaultOptions: { queries: { staleTime: 30_000, retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return renderHook(() => useJobs(), { wrapper });
}

beforeEach(() => {
  vi.useFakeTimers();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("useJobs polling", () => {
  it("keeps refetching while a job is RUNNING so the list shows the terminal status, then stops", async () => {
    fetchMock.mockImplementationOnce(() => reply([job("RUNNING")])).mockImplementation(() => reply([job("COMPLETED")]));
    const { result } = renderJobs();

    await advance(0);
    expect(result.current.data?.[0].status).toBe("RUNNING");

    await advance(2_000);
    await advance(100); // let the refetch result reach the hook
    expect(result.current.data?.[0].status).toBe("COMPLETED");

    const callsWhenDone = fetchMock.mock.calls.length;
    await advance(20_000);
    expect(fetchMock.mock.calls.length).toBe(callsWhenDone);
  });

  it("does not poll when nothing is running", async () => {
    fetchMock.mockImplementation(() => reply([job("NEW"), job("FAILED")]));
    renderJobs();
    await advance(20_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
