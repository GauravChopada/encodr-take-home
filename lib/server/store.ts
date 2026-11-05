import { randomUUID } from "node:crypto";
import { deriveTitle } from "@/lib/job-title";
import {
  type ActiveStage,
  type EncodeResult,
  type EncodeRun,
  type Job,
  type RunEvent,
} from "@/lib/types";

// In-memory store, kept on globalThis so Next dev HMR reloading this module doesn't wipe it.
// A run is a pure function of elapsed time: nothing ticks on the server, which keeps the state
// machine trivially testable and makes the SSE stream resumable (an event is just "state at tick N").

interface Store {
  jobs: Map<string, Job>;
  runs: Map<string, RunRecord>;
}

const g = globalThis as typeof globalThis & { __encodr?: Store };
g.__encodr ??= { jobs: new Map(), runs: new Map() };
const { jobs, runs } = g.__encodr;

interface RunRecord {
  id: string;
  jobId: string;
  sourceUrl: string;
  startedAt: number; // epoch ms
}

/** The "magic" source URL that should always fail partway, so reviewers can see error handling. */
export const FAIL_URL = "https://cdn.example.com/videos/corrupt.mp4";

const FAIL_ERROR = "Source stream is corrupt: invalid moov atom";
const TOTAL_MS = 31_000;
/** 60% of the way through TRANSCODING (11s-27s). */
const FAIL_AT_MS = 20_600;

const STAGE_PLAN: { stage: ActiveStage; startMs: number; endMs: number }[] = [
  { stage: "QUEUED", startMs: 0, endMs: 2_000 },
  { stage: "DOWNLOADING", startMs: 2_000, endMs: 8_000 },
  { stage: "PROBING", startMs: 8_000, endMs: 11_000 },
  { stage: "TRANSCODING", startMs: 11_000, endMs: 27_000 },
  { stage: "PACKAGING", startMs: 27_000, endMs: TOTAL_MS },
];

function pctAt(ms: number): number {
  return Math.min(100, Math.round((ms / TOTAL_MS) * 100));
}

function buildResult(): EncodeResult {
  return {
    durationSec: 184,
    renditions: [
      { label: "1080p", width: 1920, height: 1080, sizeMb: 412 },
      { label: "720p", width: 1280, height: 720, sizeMb: 188 },
      { label: "480p", width: 854, height: 480, sizeMb: 96 },
    ],
    warnings: ["Audio track 2 has no language tag"],
  };
}

function failAtMs(record: RunRecord): number | null {
  return record.sourceUrl === FAIL_URL ? FAIL_AT_MS : null;
}

/** Current state of a run: a pure function of the record and the clock. */
export function computeRun(record: RunRecord, now: number = Date.now()): EncodeRun {
  const elapsed = Math.max(0, now - record.startedAt);
  const base = { id: record.id, jobId: record.jobId };

  const failAt = failAtMs(record);
  if (failAt !== null && elapsed >= failAt) {
    return { ...base, stage: "FAILED", progressPct: pctAt(failAt), error: FAIL_ERROR };
  }
  if (elapsed >= TOTAL_MS) {
    return { ...base, stage: "COMPLETED", progressPct: 100, result: buildResult() };
  }
  const window = STAGE_PLAN.find((w) => elapsed >= w.startMs && elapsed < w.endMs);
  return { ...base, stage: window?.stage ?? "QUEUED", progressPct: pctAt(elapsed) };
}

/** The SSE event for tick `tick` (one tick per second since the run started). */
export function eventAt(record: RunRecord, tick: number): RunEvent {
  const at = (t: number) => computeRun(record, record.startedAt + t * 1000);
  const run = at(tick);
  if (run.stage === "FAILED") {
    return { stage: run.stage, progressPct: run.progressPct, message: run.error, error: run.error };
  }
  if (run.stage === "COMPLETED") {
    return { stage: run.stage, progressPct: 100, message: "Encode complete" };
  }
  const entering = tick === 0 || at(tick - 1).stage !== run.stage;
  return {
    stage: run.stage,
    progressPct: run.progressPct,
    message: entering ? `Entering ${run.stage}` : `${run.stage} ${run.progressPct}%`,
  };
}

/** First tick whose time is at or past the run's terminal time. */
export function lastTick(record: RunRecord): number {
  return Math.ceil((failAtMs(record) ?? TOTAL_MS) / 1000);
}

function isTerminal(record: RunRecord, now: number): boolean {
  const stage = computeRun(record, now).stage;
  return stage === "COMPLETED" || stage === "FAILED";
}

/** Job as stored, with `status` derived from its latest run (never stored). */
function withStatus(job: Job, now: number): Job {
  const record = job.latestRunId ? runs.get(job.latestRunId) : undefined;
  if (!record) return { ...job, status: "NEW" };
  const { stage } = computeRun(record, now);
  const status = stage === "COMPLETED" || stage === "FAILED" ? stage : "RUNNING";
  return { ...job, status };
}

// --- job/run CRUD ---

export function listJobs(now: number = Date.now()): Job[] {
  return [...jobs.values()]
    .map((j) => withStatus(j, now))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function getJob(id: string, now: number = Date.now()): Job | null {
  const job = jobs.get(id);
  return job ? withStatus(job, now) : null;
}

export function createJob(input: { sourceUrl: string; title?: string }): Job {
  const id = `j_${randomUUID().slice(0, 8)}`;
  const sourceUrl = input.sourceUrl.trim();
  const job: Job = {
    id,
    title: input.title?.trim() || deriveTitle(sourceUrl),
    sourceUrl,
    status: "NEW",
    createdAt: new Date().toISOString(),
  };
  jobs.set(id, job);
  return job;
}

/** Starts a run, or returns the job's active run if it already has one (double-click safe). */
export function startRun(jobId: string, now: number = Date.now()): RunRecord | null {
  const job = jobs.get(jobId);
  if (!job) return null;
  const existing = job.latestRunId ? runs.get(job.latestRunId) : undefined;
  if (existing && !isTerminal(existing, now)) return existing;

  const record: RunRecord = {
    id: `r_${randomUUID().slice(0, 8)}`,
    jobId,
    sourceUrl: job.sourceUrl,
    startedAt: now,
  };
  runs.set(record.id, record);
  job.latestRunId = record.id;
  return record;
}

export function getRunRecord(id: string): RunRecord | null {
  return runs.get(id) ?? null;
}

export function getRun(id: string, now: number = Date.now()): EncodeRun | null {
  const record = runs.get(id);
  return record ? computeRun(record, now) : null;
}

/** Test helper: empties the store. */
export function __resetStore(): void {
  jobs.clear();
  runs.clear();
}

export type { RunRecord };
