import { eventAt, lastTick, type RunRecord } from "@/lib/server/store";

/**
 * Server-Sent Events stream for one run. Kept out of the route file so it can be tested without Next.
 *
 * An event is a pure function of a tick number (one tick per second since the run started), so the
 * stream is resumable: a connection starts at tick `lastEventId + 1` (or 0), immediately replays any
 * ticks already due, then emits one per second and closes after the terminal tick. A page reload
 * mid-run and a reconnect after a dropped connection are the same code path.
 */
export function createRunStream(
  record: RunRecord,
  signal: AbortSignal,
  lastEventId: number | null,
  now: () => number = Date.now,
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const end = lastTick(record);
  let next = lastEventId === null ? 0 : lastEventId + 1;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let finished = false;

  return new ReadableStream<Uint8Array>({
    start(controller) {
      const finish = (close: boolean) => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        if (close) controller.close();
      };

      const emitDue = () => {
        while (!finished && next <= end && record.startedAt + next * 1000 <= now()) {
          const frame = `id: ${next}\ndata: ${JSON.stringify(eventAt(record, next))}\n\n`;
          controller.enqueue(encoder.encode(frame));
          next += 1;
        }
        if (finished) return;
        if (next > end) return finish(true);
        timer = setTimeout(emitDue, Math.max(0, record.startedAt + next * 1000 - now()));
      };

      signal.addEventListener("abort", () => finish(true), { once: true });
      if (signal.aborted) return finish(true);
      emitDue();
    },
    cancel() {
      finished = true;
      clearTimeout(timer);
    },
  });
}
