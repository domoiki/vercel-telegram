import { cn } from "@/lib/utils";

export type Tone = "neutral" | "accent" | "success" | "warning" | "error" | "info";

const TONE_COLOR: Record<Tone, string> = {
  neutral: "var(--fg-muted)",
  accent: "var(--accent)",
  success: "var(--success)",
  warning: "var(--warning)",
  error: "var(--error)",
  info: "var(--info)",
};

const TONE_WASH: Record<Tone, string> = {
  neutral: "var(--surface-3)",
  accent: "var(--accent-wash)",
  success: "var(--success-wash)",
  warning: "var(--warning-wash)",
  error: "var(--error-wash)",
  info: "var(--info-wash)",
};

/** Status reads as a lit lamp: a small filled dot plus a quiet label. */
export function StatusDot({ tone, pulse = false }: { tone: Tone; pulse?: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        "relative inline-block size-[6px] shrink-0 rounded-full",
        pulse && "after:absolute after:inset-0 after:animate-ping after:rounded-full after:opacity-60",
      )}
      style={{ backgroundColor: TONE_COLOR[tone] }}
    />
  );
}

export function Badge({
  tone = "neutral",
  children,
  className,
  dot = false,
  mono = false,
}: {
  tone?: Tone;
  children: React.ReactNode;
  className?: string;
  dot?: boolean;
  mono?: boolean;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2 py-[2px] text-[11px] leading-[16px] font-[550]",
        mono && "font-[var(--font-mono)] text-[10.5px] tracking-tight",
        className,
      )}
      style={{ backgroundColor: TONE_WASH[tone], color: TONE_COLOR[tone] }}
    >
      {dot ? <StatusDot tone={tone} /> : null}
      {children}
    </span>
  );
}

/** Neutral metadata chip: model names, adapter names, chat ids. */
export function Chip({
  children,
  className,
  title,
}: {
  children: React.ReactNode;
  className?: string;
  title?: string;
}) {
  return (
    <span
      title={title}
      className={cn(
        "inline-flex items-center gap-1 rounded-[4px] border border-[var(--line)] bg-[var(--surface-2)] px-1.5 py-[1px]",
        "font-[var(--font-mono)] text-[10.5px] leading-[16px] text-[var(--fg-muted)]",
        className,
      )}
    >
      {children}
    </span>
  );
}
