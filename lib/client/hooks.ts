"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/client/api";
import type { CreateJobInput } from "@/lib/schemas";
import type { EncodeRun, Job } from "@/lib/types";

export const jobKeys = {
  all: ["jobs"] as const,
  detail: (id: string) => ["jobs", id] as const,
};

export const runKeys = {
  detail: (id: string) => ["runs", id] as const,
};

// Two worked examples to show the intended React Query pattern:
export function useJobs() {
  return useQuery({
    queryKey: jobKeys.all,
    queryFn: ({ signal }) => api.get<Job[]>("/api/jobs", signal),
    // A run finishes on the server whether or not its detail page is open, so keep the list fresh
    // while anything is RUNNING and stop polling once nothing is.
    refetchInterval: (query) => (query.state.data?.some((j) => j.status === "RUNNING") ? 2_000 : false),
  });
}

export function useJob(id: string) {
  return useQuery({
    queryKey: jobKeys.detail(id),
    queryFn: ({ signal }) => api.get<Job>(`/api/jobs/${id}`, signal),
  });
}

/** Creates a job; the jobs list (and any job detail) refetches on success. */
export function useCreateJob() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateJobInput) => api.post<Job>("/api/jobs", input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: jobKeys.all }),
  });
}

/**
 * Starts (or, for a job that is already running, re-attaches to) a run. Invalidating `jobKeys.all`
 * also refreshes every job detail, since `["jobs", id]` sits under `["jobs"]`.
 */
export function useStartRun() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ jobId }: { jobId: string }) => api.post<{ runId: string }>("/api/runs", { jobId }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: jobKeys.all }),
  });
}

/** Snapshot of a run; the SSE stream drives live updates, this supplies the result once it is done. */
export function useRun(runId: string | undefined) {
  return useQuery({
    queryKey: runKeys.detail(runId ?? ""),
    queryFn: ({ signal }) => api.get<EncodeRun>(`/api/runs/${runId}`, signal),
    enabled: Boolean(runId),
  });
}
