import { Check, CircleAlert, Info, TriangleAlert } from "lucide-react";

import type { EventLevel } from "@/lib/db/schema";
import { errorCategoryLabel, formatDuration, formatTime } from "@/lib/format";
import { cn } from "@/lib/utils";

export type TraceRow = {
  id: string;
  event: string;
  detail: string | null;
  level: EventLevel;
  durationMs: number | null;
  createdAt: Date;
};

const LEVEL_COLOR: Record<EventLevel, string> = {
  info: "var(--fg-subtle)",
  success: "var(--success)",
  warning: "var(--warning)",
  error: "var(--error)",
};

function LevelIcon({ level }: { level: EventLevel }) {
  const color = LEVEL_COLOR[level];
  const className = "shrink-0";
  if (level === "success") return <Check size={11} strokeWidth={2.6} className={cn(className)} style={{ color }} />;
  if (level === "error") return <CircleAlert size={11} strokeWidth={2.4} className={className} style={{ color }} />;
  if (level === "warning") return <TriangleAlert size={11} strokeWidth={2.4} className={className} style={{ color }} />;
  return <Info size={11} strokeWidth={2.2} className={cn(className, "-ml-px")} style={{ color }} />;
}

/**
 * The signal trace: a message crossing the gateway, one timestamped hop at a
 * time. This is the product's centre of gravity, so it gets the monospace
 * gutter, the continuous spine and the per-step deltas.
 */
export function RequestTrace({
  events,
  showTime = true,
  className,
}: {
  events: TraceRow[];
  showTime?: boolean;
  className?: string;
}) {
  if (events.length === 0) {
    return (
      <p className={cn("text-[12.5px] text-[var(--fg-muted)]", className)}>
        No trace events were recorded for this request.
      </p>
    );
  }

  const origin = events[0]?.createdAt.getTime() ?? Date.now();

  return (
    <ol className={cn("relative", className)}>
      {/* Continuous spine behind the nodes. */}
      <span
        aria-hidden
        className="absolute top-2 bottom-2 left-[46px] w-px bg-[var(--line)] sm:left-[58px]"
      />
      {events.map((event, index) => {
        const delta = event.createdAt.getTime() - origin;
        const isFailure = event.level === "error";
        return (
          <li
            key={event.id}
            className={cn(
              "relative grid grid-cols-[38px_17px_1fr_auto] items-start gap-x-2 py-1.5 sm:grid-cols-[50px_17px_1fr_auto]",
              isFailure && "text-[var(--error)]",
            )}
          >
            <time
              dateTime={event.createdAt.toISOString()}
              className="tnum pt-[1px] text-right font-[var(--font-mono)] text-[10.5px] leading-[15px] text-[var(--fg-subtle)]"
            >
              {showTime ? formatTime(event.createdAt) : `+${delta}ms`}
            </time>

            <span className="relative flex justify-center pt-[3px]">
              <span
                aria-hidden
                className="size-[7px] rounded-full ring-[3px] ring-[var(--surface)]"
                style={{ backgroundColor: LEVEL_COLOR[event.level] }}
              />
            </span>

            <div className="min-w-0">
              <p
                className={cn(
                  "flex items-center gap-1.5 text-[12.5px] leading-[17px] font-[550]",
                  event.level === "error"
                    ? "text-[var(--error)]"
                    : event.level === "warning"
                      ? "text-[var(--warning)]"
                      : event.level === "success"
                        ? "text-[var(--success)]"
                        : "text-[var(--fg)]",
                )}
              >
                <LevelIcon level={event.level} />
                <span className="min-w-0">{event.event}</span>
              </p>
              {event.detail ? (
                <p className="mt-0.5 pl-[17px] font-[var(--font-mono)] text-[11px] leading-[15px] break-words text-[var(--fg-muted)]">
                  {event.detail}
                </p>
              ) : null}
            </div>

            <span className="tnum pt-[1px] font-[var(--font-mono)] text-[10.5px] leading-[15px] text-[var(--fg-subtle)]">
              {event.durationMs !== null ? `+${formatDuration(event.durationMs)}` : index === events.length - 1 ? "" : ""}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/** Compact horizontal summary of a provider chain run. */
export function AttemptSummary({
  attempts,
}: {
  attempts: Array<{
    attemptNumber: number;
    providerName: string;
    model: string;
    outcome: "success" | "error";
    httpStatus: number | null;
    durationMs: number;
    errorCategory: string | null;
    errorMessage: string | null;
  }>;
}) {
  if (attempts.length === 0) {
    return <p className="text-[12.5px] text-[var(--fg-muted)]">No provider was called.</p>;
  }

  return (
    <ul className="flex flex-col gap-1.5">
      {attempts.map((attempt) => {
        const ok = attempt.outcome === "success";
        return (
          <li
            key={attempt.attemptNumber}
            className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 border-b border-[var(--line-faint)] pb-1.5 last:border-0 last:pb-0"
          >
            <span className="tnum font-[var(--font-mono)] text-[10.5px] text-[var(--fg-subtle)]">
              #{attempt.attemptNumber}
            </span>
            <span className="text-[12.5px] font-[550] text-[var(--fg)]">{attempt.providerName}</span>
            <span className="font-[var(--font-mono)] text-[11px] text-[var(--fg-muted)]">
              {attempt.model}
            </span>
            <span
              className={cn(
                "font-[var(--font-mono)] text-[11px]",
                ok ? "text-[var(--success)]" : "text-[var(--error)]",
              )}
            >
              {attempt.httpStatus !== null ? `HTTP ${attempt.httpStatus}` : "no response"}
            </span>
            <span className="tnum ml-auto font-[var(--font-mono)] text-[11px] text-[var(--fg-subtle)]">
              {formatDuration(attempt.durationMs)}
            </span>
            {!ok && attempt.errorMessage ? (
              <p className="w-full font-[var(--font-mono)] text-[11px] leading-[15px] text-[var(--fg-muted)]">
                <span className="text-[var(--error)]">
                  {errorCategoryLabel(attempt.errorCategory)}
                </span>
                {" — "}
                {attempt.errorMessage}
              </p>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
