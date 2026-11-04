import { error, json, withAuth } from "@/lib/server/http";
import { getJob } from "@/lib/server/store";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return withAuth(req, async () => {
    const { id } = await params;
    const job = getJob(id);
    return job ? json(job) : error(404, "Job not found");
  });
}
