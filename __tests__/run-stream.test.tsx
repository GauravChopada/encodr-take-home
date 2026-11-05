import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { fetchEventSource, type EventSourceMessage } from "@microsoft/fetch-event-source";
import type { RunEvent } from "@/lib/types";
import { initialRunStreamState, reduceRunEvent, useRunStream } from "@/lib/client/use-run-stream";
import { clearTokens, getAccessToken, setTokens } from "@/lib/client/token-store";

vi.mock("@microsoft/fetch-event-source", () => ({ fetchEventSource: vi.fn() }));

type Options = Parameters<typeof fetchEventSource>[1];
const mockedFetch = vi.mocked(fetchEventSource);

const ev = (
  stage: Exclude<RunEvent["stage"], "FAILED">,
  progressPct: number,
  message = `${stage} ${progressPct}%`,
): RunEvent => ({
  stage,
  progressPct,
  message,
});
const frame = (id: number, event: RunEvent): EventSourceMessage => ({
  id: String(id),
  event: "",
  data: JSON.stringify(event),
});

describe("reduceRunEvent", () => {
  it("applies events in order and builds the log", () => {
    let s = reduceRunEvent(initialRunStreamState, ev("QUEUED", 0, "Entering QUEUED"), 0);
    s = reduceRunEvent(s, ev("DOWNLOADING", 7), 1);
    expect(s).toMatchObject({ stage: "DOWNLOADING", progressPct: 7, connected: true, done: false, lastId: 1 });
    expect(s.log).toEqual(["Entering QUEUED", "DOWNLOADING 7%"]);
  });

  it("ignores a replayed event it has already seen", () => {
    const once = reduceRunEvent(initialRunStreamState, ev("QUEUED", 0), 0);
    expect(reduceRunEvent(once, ev("QUEUED", 0), 0).log).toHaveLength(1);
  });

  it("records the error on FAILED and ignores anything after a terminal event", () => {
    const failed = reduceRunEvent(
      initialRunStreamState,
      { stage: "FAILED", progressPct: 66, message: "boom", error: "boom" },
      3,
    );
    expect(failed).toMatchObject({ done: true, error: "boom", stage: "FAILED" });
    expect(reduceRunEvent(failed, ev("TRANSCODING", 70), 4)).toBe(failed);
  });
});

describe("useRunStream", () => {
  let calls: { url: string; options: Options }[];

  beforeEach(() => {
    calls = [];
    mockedFetch.mockReset();
    mockedFetch.mockImplementation((url, options) => {
      calls.push({ url: String(url), options });
      return new Promise<void>(() => undefined);
    });
  });

  it("opens the run's event stream with hidden-tab streaming and the shared authed fetch", () => {
    renderHook(() => useRunStream("r_1"));
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("/api/runs/r_1/events");
    expect(calls[0].options.openWhenHidden).toBe(true);
    expect(typeof calls[0].options.fetch).toBe("function");
  });

  it("ignores a malformed frame instead of throwing", () => {
    const { result } = renderHook(() => useRunStream("r_1"));
    act(() => calls[0].options.onmessage?.({ id: "1", event: "", data: "not json" }));
    expect(result.current.stage).toBeNull();
    expect(result.current.log).toEqual([]);
  });

  it("does not connect without a run id", () => {
    renderHook(() => useRunStream(null));
    expect(calls).toHaveLength(0);
  });

  it("updates stage and progress as events arrive", () => {
    const { result } = renderHook(() => useRunStream("r_1"));
    act(() => calls[0].options.onmessage?.(frame(5, ev("TRANSCODING", 62))));
    expect(result.current).toMatchObject({ stage: "TRANSCODING", progressPct: 62, done: false });
  });

  it("aborts the connection and calls onTerminal once when the run completes", () => {
    const onTerminal = vi.fn();
    const { result } = renderHook(() => useRunStream("r_1", onTerminal));
    const { options } = calls[0];
    act(() => options.onmessage?.(frame(31, ev("COMPLETED", 100, "Encode complete"))));
    act(() => options.onmessage?.(frame(32, ev("COMPLETED", 100))));
    expect(result.current.done).toBe(true);
    expect(options.signal?.aborted).toBe(true);
    expect(onTerminal).toHaveBeenCalledTimes(1);
    expect(() => options.onclose?.()).not.toThrow();
  });

  it("asks the library to reconnect when the stream closes before the run finished", () => {
    renderHook(() => useRunStream("r_1"));
    expect(() => calls[0].options.onclose?.()).toThrow();
  });

  it("retries transient errors but gives up on a missing run", async () => {
    renderHook(() => useRunStream("r_1"));
    const { options } = calls[0];
    expect(options.onerror?.(new Error("network"))).toBe(1000);
    const fatal = await options.onopen?.(new Response("{}", { status: 404 })).catch((e: unknown) => e);
    expect(fatal).toBeInstanceOf(Error);
    expect(() => options.onerror?.(fatal)).toThrow();
  });

  it("aborts the connection on unmount", () => {
    const { unmount } = renderHook(() => useRunStream("r_1"));
    unmount();
    expect(calls[0].options.signal?.aborted).toBe(true);
  });

  it("closes the old stream and starts fresh when the run id changes", () => {
    const { result, rerender } = renderHook(({ id }) => useRunStream(id), { initialProps: { id: "r_1" } });
    act(() => calls[0].options.onmessage?.(frame(2, ev("DOWNLOADING", 7))));
    rerender({ id: "r_2" });
    expect(calls[0].options.signal?.aborted).toBe(true);
    expect(calls[1].url).toBe("/api/runs/r_2/events");
    expect(result.current).toEqual(initialRunStreamState);
  });

  it("backs off exponentially between retries, capped at 10s, and resets once events flow again", () => {
    renderHook(() => useRunStream("r_1"));
    const { options } = calls[0];
    const delays = [1, 2, 3, 4, 5, 6].map(() => options.onerror?.(new Error("network")));
    expect(delays).toEqual([1000, 2000, 4000, 8000, 10_000, 10_000]);
    act(() => options.onmessage?.(frame(1, ev("QUEUED", 3))));
    expect(options.onerror?.(new Error("network"))).toBe(1000);
  });

  it("marks the stream as fatally failed when the connection gives up", async () => {
    mockedFetch.mockImplementationOnce(() => Promise.reject(new Error("Live updates unavailable (404)")));
    const { result } = renderHook(() => useRunStream("r_1"));
    await waitFor(() => expect(result.current.error).toBe("Live updates unavailable (404)"));
    expect(result.current.connected).toBe(false);
  });
});

describe("the stream's connection auth", () => {
  const sent: { path: string; auth: string | null }[] = [];
  const fetchStub = vi.fn<typeof fetch>();

  beforeEach(() => {
    sent.length = 0;
    fetchStub.mockReset();
    fetchStub.mockImplementation(async (path, init) => {
      const auth = new Headers(init?.headers).get("authorization");
      sent.push({ path: String(path), auth });
      if (path === "/api/auth/refresh") return new Response(JSON.stringify({ accessToken: "T2" }), { status: 200 });
      return auth === "Bearer T2"
        ? new Response("", { status: 200, headers: { "content-type": "text/event-stream" } })
        : new Response(JSON.stringify({ detail: "expired" }), { status: 401 });
    });
    vi.stubGlobal("fetch", fetchStub);
    clearTokens();
    setTokens({ accessToken: "T1", refreshToken: "R1" });
    mockedFetch.mockReset();
    mockedFetch.mockImplementation(() => new Promise<void>(() => undefined));
  });
  afterEach(() => vi.unstubAllGlobals());

  it("refreshes an expired token and retries the stream request through the shared fetch", async () => {
    renderHook(() => useRunStream("r_1"));
    const connect = mockedFetch.mock.calls[0][1].fetch!;
    const res = await connect("/api/runs/r_1/events", { headers: { accept: "text/event-stream", "last-event-id": "7" } });

    expect(res.status).toBe(200);
    expect(sent.map((s) => [s.path, s.auth])).toEqual([
      ["/api/runs/r_1/events", "Bearer T1"],
      ["/api/auth/refresh", null],
      ["/api/runs/r_1/events", "Bearer T2"],
    ]);
    expect(getAccessToken()).toBe("T2");
  });
});
