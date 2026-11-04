import type { EncodeResult } from "@/lib/types";

function formatDuration(totalSec: number): string {
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function RunResults({ result }: { result: EncodeResult }) {
  return (
    <section aria-labelledby="results-heading" className="space-y-4">
      <h2 id="results-heading" className="text-lg font-semibold">
        Results
      </h2>
      <p className="text-sm text-neutral-600">Duration: {formatDuration(result.durationSec)}</p>

      <table className="w-full text-left text-sm">
        <caption className="sr-only">Output renditions</caption>
        <thead>
          <tr className="border-b border-neutral-300 text-neutral-600">
            <th scope="col" className="py-2 pr-4 font-medium">
              Rendition
            </th>
            <th scope="col" className="py-2 pr-4 font-medium">
              Resolution
            </th>
            <th scope="col" className="py-2 font-medium">
              Size
            </th>
          </tr>
        </thead>
        <tbody>
          {result.renditions.map((r) => (
            <tr key={r.label} className="border-b border-neutral-200">
              <th scope="row" className="py-2 pr-4 font-medium">
                {r.label}
              </th>
              <td className="py-2 pr-4">
                {r.width}x{r.height}
              </td>
              <td className="py-2">{r.sizeMb} MB</td>
            </tr>
          ))}
        </tbody>
      </table>

      {result.warnings.length > 0 && (
        <div>
          <h3 className="mb-1 text-sm font-medium">Warnings</h3>
          <ul className="list-disc space-y-1 pl-5 text-sm text-amber-700 dark:text-amber-400">
            {result.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
