/**
 * Title for a job created without one: the last path segment of the source URL.
 * Shared so the optimistic row on the client shows exactly what the server will store.
 */
export function deriveTitle(sourceUrl: string): string {
  try {
    const path = new URL(sourceUrl).pathname.replace(/\/+$/, "");
    const last = path.split("/").filter(Boolean).pop();
    // Keep a derived title within the same 80 character limit the form enforces on typed titles.
    return last ? decodeURIComponent(last).slice(0, 80) : "Untitled encode";
  } catch {
    return "Untitled encode";
  }
}
