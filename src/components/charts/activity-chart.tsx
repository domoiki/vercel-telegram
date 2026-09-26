import type { DailyBucket } from "@/lib/queries";
import { formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * Message activity for the last N days.
 *
 * Drawn with plain elements rather than a charting dependency: two bars per day
 * (what arrived vs. what went back), a hairline grid, and no gradients. The
 * numbers under the chart carry the precision the bars cannot.
 */
export function ActivityChart({
  data,
  height = 148,
  className,
}: {
  data: DailyBucket[];
  height?: number;
  className?: string;
}) {
  const max = Math.max(1, ...data.map((d) => Math.max(d.inbound, d.outbound)));
  const total = data.reduce((sum, d) => sum + d.inbound + d.outbound, 0);
  // At most 6 x-axis labels, so they stay readable on a 320px phone.
  const labelStep = Math.max(1, Math.ceil(data.length / 6));
  const peak = data.reduce<DailyBucket | null>(
    (best, d) => (!best || Math.max(d.inbound, d.outbound) > Math.max(best.inbound, best.outbound) ? d : best),
    null,
  );

  if (total === 0) {
    return (
      <div
        className={cn(
          "flex items-center justify-center rounded-[var(--radius-control)] border border-dashed border-[var(--line)] text-[12.5px] text-[var(--fg-subtle)]",
          className,
        )}
        style={{ height }}
      >
        No messages in this window yet
      </div>
    );
  }

  return (
    <div className={className}>
      <div className="flex gap-3">
        {/* Grid lines sit behind the bars. */}
        <div
          aria-hidden
          className="relative w-px shrink-0"
          style={{ height }}
        >
          <span className="absolute top-0 left-0 w-px bg-[var(--chart-axis)]" style={{ height: "100%" }} />
        </div>

        <div className="min-w-0 flex-1">
          <div
            className="relative flex items-end gap-[3px]"
            style={{ height }}
            role="img"
            aria-label={`Message activity over the last ${data.length} days. ${formatNumber(total)} messages total.`}
          >
            <span
              aria-hidden
              className="absolute inset-x-0 top-1/2 h-px bg-[var(--chart-grid)]"
            />
            <span aria-hidden className="absolute inset-x-0 top-0 h-px bg-[var(--chart-grid)]" />

            {data.map((day) => {
              const inH = Math.round((day.inbound / max) * (height - 2));
              const outH = Math.round((day.outbound / max) * (height - 2));
              return (
                <div
                  key={day.day}
                  className="group relative flex h-full min-w-0 flex-1 items-end justify-center gap-[2px]"
                >
                  <div
                    className="w-[45%] min-w-[2px] max-w-[14px] rounded-t-[2px] bg-[var(--fg-subtle)]/45 transition-colors duration-120 group-hover:bg-[var(--fg-subtle)]/70"
                    style={{ height: Math.max(day.inbound > 0 ? 2 : 0, inH) }}
                  >
                    <title>{`${day.label} — ${day.inbound} inbound`}</title>
                  </div>
                  <div
                    className="w-[45%] min-w-[2px] max-w-[14px] rounded-t-[2px] bg-[var(--accent)]/70 transition-colors duration-120 group-hover:bg-[var(--accent)]"
                    style={{ height: Math.max(day.outbound > 0 ? 2 : 0, outH) }}
                  >
                    <title>{`${day.label} — ${day.outbound} outbound`}</title>
                  </div>
                </div>
              );
            })}
          </div>

          {/*
            The axis renders only the labels it can show, spread edge to edge.
            A per-column label would contribute its full text width to the
            chart's intrinsic min-content size and push the page into horizontal
            overflow on a phone.
          */}
          <div className="mt-1.5 flex items-baseline justify-between gap-1">
            {data
              .map((day, index) => ({ day, index }))
              .filter(({ index }) => index % labelStep === 0 || index === data.length - 1)
              .map(({ day }, i, all) => (
                <span
                  key={day.day}
                  className={cn(
                    "font-[var(--font-mono)] text-[10.5px] leading-3.5 whitespace-nowrap text-[var(--fg-subtle)]",
                    i === 0 && "text-left",
                    i > 0 && i < all.length - 1 && "text-center",
                    i === all.length - 1 && "text-right",
                  )}
                >
                  {day.label}
                </span>
              ))}
          </div>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-[var(--line-faint)] pt-2.5">
        <Legend swatch="bg-[var(--fg-subtle)]/60" label="Inbound" />
        <Legend swatch="bg-[var(--accent)]/80" label="Outbound" />
        <span className="ml-auto flex items-center gap-3 font-[var(--font-mono)] text-[10.5px] text-[var(--fg-subtle)]">
          <span>
            peak day <span className="text-[var(--fg-muted)]">{peak?.label ?? "—"}</span>
          </span>
          <span>
            max <span className="text-[var(--fg-muted)]">{max}</span>/day
          </span>
        </span>
      </div>
    </div>
  );
}

function Legend({ swatch, label }: { swatch: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] text-[var(--fg-muted)]">
      <span aria-hidden className={cn("size-2 rounded-[2px]", swatch)} />
      {label}
    </span>
  );
}

/** Horizontal comparison bar used for provider latency tables. */
export function LatencyBar({
  value,
  max,
  tone = "accent",
}: {
  value: number;
  max: number;
  tone?: "accent" | "warning" | "error";
}) {
  const width = max <= 0 ? 0 : Math.max(2, Math.round((value / max) * 100));
  const color =
    tone === "error" ? "var(--error)" : tone === "warning" ? "var(--warning)" : "var(--accent)";
  return (
    <span
      aria-hidden
      className="block h-1.5 w-full overflow-hidden rounded-full bg-[var(--surface-3)]"
    >
      <span
        className="block h-full rounded-full transition-[width] duration-200"
        style={{ width: `${width}%`, backgroundColor: color }}
      />
    </span>
  );
}
