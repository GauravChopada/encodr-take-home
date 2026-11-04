import { createJobSchema } from "@/lib/schemas";
import { createJob, listJobs } from "@/lib/server/store";
import { json, readJson, validationError, withAuth } from "@/lib/server/http";

export async function GET(req: Request) {
  return withAuth(req, () => json(listJobs()));
}

export async function POST(req: Request) {
  return withAuth(req, async () => {
    const parsed = createJobSchema.safeParse(await readJson(req));
    if (!parsed.success) return validationError(parsed.error);

    const job = createJob({ sourceUrl: parsed.data.sourceUrl, title: parsed.data.title });
    return json(job, 201);
  });
}
