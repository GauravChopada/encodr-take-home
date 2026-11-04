import { error, json, withAuth } from "@/lib/server/http";
import { getRun } from "@/lib/server/store";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return withAuth(req, async () => {
    const { id } = await params;
    const run = getRun(id);
    return run ? json(run) : error(404, "Run not found");
  });
}
