"use client";

import { use, useCallback } from "react";
import Link from "next/link";
import { useQueryClient } from "@tanstack/react-query";
import { jobKeys, runKeys, useJob, useRun, useStartRun } from "@/lib/client/hooks";
import { useRunStream } from "@/lib/client/use-run-stream";
import { ACTIVE_STAGES } from "@/lib/types";
import { ProgressBar } from "@/components/progress-bar";
import { RunResults } from "@/components/run-results";
import { StatusBadge } from "@/components/status-badge";

export default function JobDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const queryClient = useQueryClient();
  const jobQuery = useJob(id);
  const startRun = useStartRun();

  // The run to watch comes from server data, so a reload or navigating back resumes the same run.
  const runId = jobQuery.data?.latestRunId;
  const runQuery = useRun(runId);

  // When the stream reports a terminal stage, refresh the list/detail status and the run snapshot
  // (which carries the result).
  const onTerminal = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: jobKeys.all });
    if (runId) void queryClient.invalidateQueries({ queryKey: runKeys.detail(runId) });
  }, [queryClient, runId]);
  const stream = useRunStream(runId ?? null, onTerminal);

  if (jobQuery.isLoading) return <p className="text-sm text-neutral-500">Loading job...</p>;
  if (jobQuery.isError || !jobQuery.data) {
    return (
      <div className="text-sm text-red-600">
        Job not found.{" "}
        <Link href="/jobs" className="underline">
          Back to jobs
        </Link>
      </div>
    );
  }

  const job = jobQuery.data;
  const snapshot = runQuery.data;
  const stage = stream.stage ?? snapshot?.stage ?? null;
  const progressPct = stream.stage ? stream.progressPct : (snapshot?.progressPct ?? 0);
  const failed = stage === "FAILED";
  const completed = stage === "COMPLETED";
  const running = Boolean(runId) && !failed && !completed;
  const failureMessage = stream.error ?? (snapshot?.stage === "FAILED" ? snapshot.error : null);
  const result = snapshot?.stage === "COMPLETED" ? snapshot.result : null;
  const currentIndex = ACTIVE_STAGES.findIndex((s) => s === stage);

  const startLabel = failed ? "Retry" : completed ? "Run again" : "Start encode";

  return (
    <div className="space-y-6">
      <Link href="/jobs" className="text-sm text-neutral-500 hover:underline">
        ← All jobs
      </Link>

      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="truncate text-xl font-semibold">{job.title}</h1>
          <p className="truncate text-sm text-neutral-500">{job.sourceUrl}</p>
        </div>
        <StatusBadge value={job.status} />
      </div>

      <div className="flex items-center gap-3">
        <button
          onClick={() => startRun.mutate({ jobId: job.id })}
          disabled={running || startRun.isPending}
          className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {startRun.isPending ? "Starting..." : startLabel}
        </button>
        {startRun.isError && (
          <p role="alert" className="text-sm text-red-600">
            Could not start the encode. Try again.
          </p>
        )}
      </div>

      {runId && (
        <section aria-labelledby="progress-heading" className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 id="progress-heading" className="text-lg font-semibold">
              Progress
            </h2>
            <span aria-live="polite" className="text-sm text-neutral-600">
              {stage ?? "Connecting..."} {stage ? `${progressPct}%` : ""}
            </span>
          </div>

          <ProgressBar value={progressPct} failed={failed} />

          <ol className="flex flex-wrap gap-2 text-xs">
            {ACTIVE_STAGES.map((s, i) => (
              <li
                key={s}
                className={
                  completed || i < currentIndex
                    ? "rounded-full bg-green-100 px-2.5 py-0.5 text-green-700"
                    : i === currentIndex
                      ? "rounded-full bg-blue-100 px-2.5 py-0.5 font-medium text-blue-700"
                      : "rounded-full bg-neutral-200 px-2.5 py-0.5 text-neutral-600"
                }
                aria-current={i === currentIndex ? "step" : undefined}
              >
                {s}
              </li>
            ))}
          </ol>

          {stream.error && !failed && (
            <p role="alert" className="text-sm text-red-600">
              {stream.error}. Reload the page to retry.
            </p>
          )}

          <ul
            role="log"
            aria-live="polite"
            aria-label="Encode log"
            className="max-h-56 overflow-y-auto rounded-md border border-neutral-200 p-3 font-mono text-xs text-neutral-700 dark:border-neutral-800 dark:text-neutral-300"
          >
            {stream.log.length === 0 && <li className="text-neutral-500">Waiting for events...</li>}
            {stream.log.map((line, i) => (
              <li key={i}>{line}</li>
            ))}
          </ul>
        </section>
      )}

      {failed && (
        <div
          role="alert"
          className="rounded-md border border-red-300 bg-red-50 p-4 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200"
        >
          <p className="font-medium">Encode failed</p>
          <p>{failureMessage ?? "The run failed."}</p>
          <p className="mt-1">Use Retry to start a new run.</p>
        </div>
      )}

      {completed &&
        (result ? (
          <RunResults result={result} />
        ) : (
          <p className="text-sm text-neutral-500">Loading results...</p>
        ))}
    </div>
  );
}
