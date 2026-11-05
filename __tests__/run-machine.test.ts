import { beforeEach, describe, expect, it } from "vitest";
import {
  FAIL_URL,
  __resetStore,
  computeRun,
  createJob,
  eventAt,
  getJob,
  lastTick,
  listJobs,
  startRun,
  type RunRecord,
} from "@/lib/server/store";
import type { EncodeRun, Stage } from "@/lib/types";

const OK_URL = "https://cdn.example.com/videos/sample.mp4";
const FAIL_ERROR = "Source stream is corrupt: invalid moov atom";

function newRun(sourceUrl: string, now = 0): RunRecord {
  const job = createJob({ sourceUrl });
  const record = startRun(job.id, now);
  if (!record) throw new Error("run not started");
  return record;
}

beforeEach(() => __resetStore());

describe("computeRun stages", () => {
  const cases: [number, Stage][] = [
    [0, "QUEUED"],
    [1999, "QUEUED"],
    [2000, "DOWNLOADING"],
    [7999, "DOWNLOADING"],
    [8000, "PROBING"],
    [10999, "PROBING"],
    [11000, "TRANSCODING"],
    [26999, "TRANSCODING"],
    [27000, "PACKAGING"],
    [30999, "PACKAGING"],
    [31000, "COMPLETED"],
  ];
  it.each(cases)("at %i ms the stage is %s", (elapsed, stage) => {
    expect(computeRun(newRun(OK_URL), elapsed).stage).toBe(stage);
  });

  it("never lets progress go backwards and spans 0 to 100", () => {
    const record = newRun(OK_URL);
    let prev = -1;
    for (let t = 0; t <= 40_000; t += 500) {
      const pct = computeRun(record, t).progressPct;
      expect(pct).toBeGreaterThanOrEqual(prev);
      prev = pct;
    }
    expect(computeRun(record, 0).progressPct).toBe(0);
    expect(computeRun(record, 31_000).progressPct).toBe(100);
  });

  it("attaches a three-rendition result only on COMPLETED", () => {
    const record = newRun(OK_URL);
    const done = computeRun(record, 31_000);
    expect(done.stage === "COMPLETED" && done.result.renditions.length).toBe(3);
    expect("result" in computeRun(record, 30_999)).toBe(false);
  });
});

describe("failing source", () => {
  it("fails at 20600 ms and stays failed with the same progress", () => {
    const record = newRun(FAIL_URL);
    expect(computeRun(record, 20_599).stage).toBe("TRANSCODING");
    const failed = computeRun(record, 20_600);
    expect(failed.stage).toBe("FAILED");
    expect(failed.stage === "FAILED" && failed.error).toBe(FAIL_ERROR);
    const later = computeRun(record, 60_000);
    expect(later.stage).toBe("FAILED");
    expect(later.progressPct).toBe(failed.progressPct);
  });
});

describe("event ticks", () => {
  it("lastTick is the first whole second at or past the terminal time", () => {
    expect(lastTick(newRun(OK_URL))).toBe(31);
    expect(lastTick(newRun(FAIL_URL))).toBe(21);
  });

  it("builds stage-entry, progress and terminal events from the tick number", () => {
    const record = newRun(OK_URL);
    expect(eventAt(record, 11).message).toBe("Entering TRANSCODING");
    expect(eventAt(record, 12).message).toBe("TRANSCODING 39%");
    expect(eventAt(record, 31).stage).toBe("COMPLETED");
  });
});

describe("derived job status and run start", () => {
  it("derives status from the latest run and never stores it", () => {
    const job = createJob({ sourceUrl: OK_URL });
    expect(getJob(job.id, 0)?.status).toBe("NEW");
    startRun(job.id, 0);
    expect(getJob(job.id, 5000)?.status).toBe("RUNNING");
    expect(getJob(job.id, 31_000)?.status).toBe("COMPLETED");
    expect(listJobs(31_000)[0].status).toBe("COMPLETED");
  });

  it("marks the failing job FAILED once the failure time has passed", () => {
    const record = newRun(FAIL_URL);
    expect(getJob(record.jobId, 21_000)?.status).toBe("FAILED");
  });

  it("returns the same run while one is active, a new run after it ends", () => {
    const job = createJob({ sourceUrl: OK_URL });
    const first = startRun(job.id, 0);
    expect(startRun(job.id, 5000)?.id).toBe(first?.id);
    const next = startRun(job.id, 31_000);
    expect(next?.id).not.toBe(first?.id);
    expect(getJob(job.id, 31_000)?.latestRunId).toBe(next?.id);
  });
});

describe("derived titles", () => {
  it("keeps a title derived from a very long file name within the 80 character limit", () => {
    const job = createJob({ sourceUrl: `https://cdn.example.com/videos/${"a".repeat(150)}.mp4` });
    expect(job.title.length).toBeLessThanOrEqual(80);
  });
});

describe("EncodeRun type", () => {
  it("rejects a FAILED run without an error", () => {
    // @ts-expect-error FAILED requires an error message
    const bad: EncodeRun = { id: "r", jobId: "j", stage: "FAILED", progressPct: 10 };
    expect(bad.stage).toBe("FAILED");
  });
});
