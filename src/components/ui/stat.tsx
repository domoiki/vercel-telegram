import { cn } from "@/lib/utils";

/**
 * A metric cell. The Overview renders these inside one divided panel rather
 * than as separate cards — metrics belong on a shared baseline, not on six
 * floating tiles.
 */
export function StatCell({
  label,
  value,
  unit,
  detail,
  tone,
  className,
}: {
  label: string;
  value: string;
  unit?: string;
  detail?: React.ReactNode;
  tone?: "default" | "success" | "warning" | "error";
  className?: string;
}) {
  return (
    <div className={cn("flex min-w-0 flex-col justify-between gap-2 bg-[var(--surface)] px-4 py-3.5", className)}>
      <span className="text-[11.5px] leading-4 font-[550] text-[var(--fg-muted)]">{label}</span>
      <span
        className={cn(
          "tnum flex items-baseline gap-1 text-[22px] leading-7 font-[620] tracking-[-0.02em]",
          tone === "success" && "text-[var(--success)]",
          tone === "warning" && "text-[var(--warning)]",
          tone === "error" && "text-[var(--error)]",
          !tone && "text-[var(--fg)]",
        )}
      >
        {value}
        {unit ? (
          <span className="text-[12px] font-[500] tracking-normal text-[var(--fg-subtle)]">
            {unit}
          </span>
        ) : null}
      </span>
      {detail ? (
        <span className="truncate text-[11.5px] leading-4 text-[var(--fg-subtle)]">{detail}</span>
      ) : null}
    </div>
  );
}

/**
 * Divided grid. Cells share one panel and are separated by 1px gaps in the
 * line colour, which gives real hairlines in both axes without extra borders.
 */
export function StatGrid({
  children,
  columns = 4,
  className,
}: {
  children: React.ReactNode;
  columns?: 2 | 3 | 4 | 5;
  className?: string;
}) {
  const cols =
    columns === 2
      ? "grid-cols-1 sm:grid-cols-2"
      : columns === 3
        ? "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3"
        : columns === 5
          ? "grid-cols-2 lg:grid-cols-3 xl:grid-cols-5"
          : "grid-cols-2 lg:grid-cols-4";
  return (
    <div
      className={cn(
        "panel grid gap-px overflow-hidden bg-[var(--line)] p-px",
        cols,
        className,
      )}
    >
      {children}
    </div>
  );
}

export function Divider({ className }: { className?: string }) {
  return <span aria-hidden className={cn("hidden w-px bg-[var(--line)] sm:block", className)} />;
}

/** Label + value row used across detail panels. */
export function MetaRow({
  label,
  children,
  mono = false,
}: {
  label: string;
  children: React.ReactNode;
  mono?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-[var(--line-faint)] py-1.5 last:border-0">
      <dt className="text-[12px] text-[var(--fg-muted)]">{label}</dt>
      <dd
        className={cn(
          "min-w-0 truncate text-right text-[12.5px] font-[500] text-[var(--fg)]",
          mono && "font-[var(--font-mono)] text-[11.5px]",
        )}
      >
        {children}
      </dd>
    </div>
  );
}
