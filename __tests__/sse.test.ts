// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRunStream } from "@/lib/server/sse";
import { __resetStore, createJob, startRun, type RunRecord } from "@/lib/server/store";

const T0 = 1_700_000_000_000;

function newRecord(): RunRecord {
  const job = createJob({ sourceUrl: "https://cdn.example.com/videos/a.mp4" });
  const record = startRun(job.id, Date.now());
  if (!record) throw new Error("run not started");
  return record;
}

/** Drains a stream in the background, collecting decoded frames and whether it closed. */
function collect(stream: ReadableStream<Uint8Array>) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  const out = { text: "", closed: false, reader };
  void (async () => {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        out.closed = true;
        return;
      }
      out.text += decoder.decode(value);
    }
  })().catch(() => undefined);
  return out;
}

const ids = (text: string) => [...text.matchAll(/^id: (\d+)$/gm)].map((m) => Number(m[1]));
const flush = () => vi.advanceTimersByTimeAsync(0);

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(T0);
  __resetStore();
});
afterEach(() => vi.useRealTimers());

describe("createRunStream", () => {
  it("replays every tick from 0 on a fresh connect, then one tick per second", async () => {
    const record = newRecord();
    await vi.advanceTimersByTimeAsync(5000);
    const out = collect(createRunStream(record, new AbortController().signal, null));
    await flush();
    expect(ids(out.text)).toEqual([0, 1, 2, 3, 4, 5]);
    await vi.advanceTimersByTimeAsync(1000);
    expect(ids(out.text).at(-1)).toBe(6);
  });

  it("resumes after Last-Event-ID without repeating earlier ticks", async () => {
    const record = newRecord();
    await vi.advanceTimersByTimeAsync(5000);
    const out = collect(createRunStream(record, new AbortController().signal, 3));
    await flush();
    expect(ids(out.text)).toEqual([4, 5]);
  });

  it("ends with a COMPLETED event and closes the stream", async () => {
    const record = newRecord();
    const out = collect(createRunStream(record, new AbortController().signal, null));
    await vi.advanceTimersByTimeAsync(31_000);
    expect(ids(out.text).at(-1)).toBe(31);
    expect(out.text).toContain('"stage":"COMPLETED"');
    expect(out.closed).toBe(true);
  });

  it("replays through the terminal tick and closes when the run already finished", async () => {
    const record = newRecord();
    await vi.advanceTimersByTimeAsync(40_000);
    const out = collect(createRunStream(record, new AbortController().signal, null));
    await flush();
    expect(ids(out.text)).toHaveLength(32);
    expect(out.closed).toBe(true);
  });

  it("closes immediately with no frames when Last-Event-ID is past the end", async () => {
    const record = newRecord();
    const out = collect(createRunStream(record, new AbortController().signal, 9999));
    await flush();
    expect(out.text).toBe("");
    expect(out.closed).toBe(true);
  });

  it("clears its timer when the client aborts", async () => {
    const record = newRecord();
    await vi.advanceTimersByTimeAsync(5000);
    const controller = new AbortController();
    collect(createRunStream(record, controller.signal, null));
    await flush();
    expect(vi.getTimerCount()).toBe(1);
    controller.abort();
    await flush();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("clears its timer when the reader cancels", async () => {
    const record = newRecord();
    await vi.advanceTimersByTimeAsync(5000);
    const out = collect(createRunStream(record, new AbortController().signal, null));
    await flush();
    await out.reader.cancel();
    expect(vi.getTimerCount()).toBe(0);
  });
});
