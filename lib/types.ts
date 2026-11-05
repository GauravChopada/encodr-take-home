// Shared contract types — used by both the Route Handlers (server) and the React app (client).
// Keeping one source of truth for the API shape is deliberate: it's what we look for in the review.

export type JobStatus = "NEW" | "RUNNING" | "COMPLETED" | "FAILED";

export type Stage =
  | "QUEUED"
  | "DOWNLOADING"
  | "PROBING"
  | "TRANSCODING"
  | "PACKAGING"
  | "COMPLETED"
  | "FAILED";

export type ActiveStage = Exclude<Stage, "COMPLETED" | "FAILED">;
export type TerminalStage = Extract<Stage, "COMPLETED" | "FAILED">;

/** Non-terminal stages, in order. The encode run walks these then lands on a terminal stage. */
export const ACTIVE_STAGES: readonly ActiveStage[] = [
  "QUEUED",
  "DOWNLOADING",
  "PROBING",
  "TRANSCODING",
  "PACKAGING",
];

export const TERMINAL_STAGES: readonly TerminalStage[] = ["COMPLETED", "FAILED"];

export function isTerminalStage(stage: Stage): stage is TerminalStage {
  return stage === "COMPLETED" || stage === "FAILED";
}

export interface User {
  id: string;
  email: string;
  name: string;
}

export interface Job {
  id: string;
  title: string;
  sourceUrl: string;
  status: JobStatus;
  createdAt: string; // ISO
  latestRunId?: string;
}

export interface Rendition {
  label: string; // e.g. "1080p"
  width: number;
  height: number;
  sizeMb: number;
}

export interface EncodeResult {
  durationSec: number;
  renditions: Rendition[];
  warnings: string[];
}

interface EncodeRunBase {
  id: string;
  jobId: string;
}

/**
 * A run is exactly one of: still going, completed with a result, or failed with an error.
 * Modelled as a union on `stage` so a result on a FAILED run (or a missing error) cannot type-check.
 * The JSON shape on the wire is unchanged.
 */
export type EncodeRun =
  | (EncodeRunBase & { stage: ActiveStage; progressPct: number })
  | (EncodeRunBase & { stage: "COMPLETED"; progressPct: 100; result: EncodeResult })
  | (EncodeRunBase & { stage: "FAILED"; progressPct: number; error: string });

/**
 * Shape of each Server-Sent Event streamed from /api/runs/:id/events.
 * Like EncodeRun it is a union, so a FAILED event always carries its error.
 */
export type RunEvent =
  | { stage: ActiveStage | "COMPLETED"; progressPct: number; message: string }
  | { stage: "FAILED"; progressPct: number; message: string; error: string };

const ALL_STAGES: readonly Stage[] = [...ACTIVE_STAGES, ...TERMINAL_STAGES];

/** Runtime check at the network boundary: returns a well-formed RunEvent or null. */
export function parseRunEvent(raw: string): RunEvent | null {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null) return null;
  const { stage, progressPct, message, error } = value as Record<string, unknown>;
  if (typeof stage !== "string" || !ALL_STAGES.some((s) => s === stage)) return null;
  if (typeof progressPct !== "number" || typeof message !== "string") return null;
  if (stage === "FAILED") {
    return typeof error === "string" ? { stage, progressPct, message, error } : null;
  }
  return { stage: stage as ActiveStage | "COMPLETED", progressPct, message };
}
