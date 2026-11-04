import { z } from "zod";
import { getUserIdFromRequest } from "@/lib/server/auth";

export function json(data: unknown, init?: number | ResponseInit): Response {
  const responseInit: ResponseInit = typeof init === "number" ? { status: init } : (init ?? {});
  return new Response(JSON.stringify(data), {
    ...responseInit,
    headers: { "content-type": "application/json", ...(responseInit.headers ?? {}) },
  });
}

export function error(status: number, detail: string): Response {
  return json({ detail }, status);
}

/** Returns the authenticated userId, or throws a Response (401) to be caught by the handler. */
export function requireUser(req: Request): string {
  const userId = getUserIdFromRequest(req);
  if (!userId) throw error(401, "Not authenticated");
  return userId;
}

/** Runs a handler, turning a thrown Response (e.g. from requireUser or readJson) into the response. */
export async function handle(fn: () => Promise<Response> | Response): Promise<Response> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof Response) return e;
    throw e;
  }
}

/** Wraps a handler so unauthenticated requests get a 401 before it runs. */
export function withAuth(
  req: Request,
  handler: (userId: string) => Promise<Response> | Response,
): Promise<Response> {
  return handle(() => handler(requireUser(req)));
}

/** Parses the JSON body; throws a 400 Response if it is missing or not valid JSON. */
export async function readJson(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    throw error(400, "Request body must be valid JSON");
  }
}

/** 422 in the shape the client maps onto form fields. */
export function validationError(err: z.ZodError): Response {
  return json({ detail: "Validation failed", fieldErrors: z.flattenError(err).fieldErrors }, 422);
}
