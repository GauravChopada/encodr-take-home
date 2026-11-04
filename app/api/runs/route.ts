import { startRunSchema } from "@/lib/schemas";
import { error, json, readJson, validationError, withAuth } from "@/lib/server/http";
import { getJob, startRun } from "@/lib/server/store";

// Starts a run for a job. If the job already has an active run, returns that run (200) so a
// double-click can't start two; a new run is 201.
export async function POST(req: Request) {
  return withAuth(req, async () => {
    const parsed = startRunSchema.safeParse(await readJson(req));
    if (!parsed.success) return validationError(parsed.error);

    const { jobId } = parsed.data;
    const before = getJob(jobId)?.latestRunId;
    const record = startRun(jobId);
    if (!record) return error(404, "Job not found");

    return json({ runId: record.id }, record.id === before ? 200 : 201);
  });
}
