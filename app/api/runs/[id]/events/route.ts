import { error, withAuth } from "@/lib/server/http";
import { createRunStream } from "@/lib/server/sse";
import { getRunRecord } from "@/lib/server/store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Live progress as Server-Sent Events. Auth is the same bearer header as every other route: the client
// opens this with @microsoft/fetch-event-source (native EventSource can't set headers). Auth and 404
// are checked before the stream exists, so failures are plain JSON responses.
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return withAuth(req, async () => {
    const { id } = await params;
    const record = getRunRecord(id);
    if (!record) return error(404, "Run not found");

    // Reconnects send Last-Event-ID; anything that isn't a plain integer is treated as a fresh connect.
    const header = req.headers.get("last-event-id");
    const lastEventId = header !== null && /^\d+$/.test(header) ? Number(header) : null;

    return new Response(createRunStream(record, req.signal, lastEventId), {
      headers: {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache, no-transform",
        "x-accel-buffering": "no",
      },
    });
  });
}
