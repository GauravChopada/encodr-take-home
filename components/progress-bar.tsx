import { clsx } from "clsx";

export function ProgressBar({
  value,
  failed,
  label = "Encode progress",
}: {
  value: number;
  failed?: boolean;
  label?: string;
}) {
  const pct = Math.min(100, Math.max(0, value));
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pct}
      className="h-2 w-full overflow-hidden rounded-full bg-neutral-200"
    >
      <div
        className={clsx(
          "h-full transition-all duration-300 motion-reduce:transition-none",
          failed ? "bg-red-500" : "bg-blue-500",
        )}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}
