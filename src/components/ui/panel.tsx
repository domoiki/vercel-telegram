import Link from "next/link";
import { ArrowUpRight } from "lucide-react";

import { cn } from "@/lib/utils";

export function Panel({
  className,
  children,
  as: As = "section",
}: {
  className?: string;
  children: React.ReactNode;
  as?: React.ElementType;
}) {
  return <As className={cn("panel", className)}>{children}</As>;
}

export function PanelHeader({
  title,
  description,
  action,
  className,
  /** Small monospace label above the title, used only where it carries meaning. */
  kicker,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
  kicker?: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex items-start justify-between gap-4 border-b border-[var(--line)] px-4 py-3",
        className,
      )}
    >
      <div className="min-w-0">
        {kicker ? (
          <div className="mb-1 font-[var(--font-mono)] text-[10.5px] tracking-[0.08em] text-[var(--fg-subtle)] uppercase">
            {kicker}
          </div>
        ) : null}
        <h2 className="truncate text-[13.5px] leading-5 font-[600] tracking-[-0.005em] text-[var(--fg)]">
          {title}
        </h2>
        {description ? (
          <p className="mt-0.5 text-[12px] leading-[17px] text-[var(--fg-muted)]">{description}</p>
        ) : null}
      </div>
      {action ? <div className="flex shrink-0 items-center gap-2">{action}</div> : null}
    </div>
  );
}

/**
 * A text link used in a panel header. It keeps a 28px hit area even though the
 * glyphs are 12px, so it stays tappable on a phone.
 */
export function PanelLink({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className="-mr-1.5 inline-flex min-h-7 items-center gap-1 rounded-[var(--radius-control)] px-1.5 text-[12px] font-[550] text-[var(--fg-muted)] transition-colors hover:text-[var(--fg)] focus-visible:outline-2 focus-visible:outline-[var(--accent)] focus-visible:outline-offset-1"
    >
      {children}
      <ArrowUpRight size={12} strokeWidth={2} />
    </Link>
  );
}

/** Page heading used at the top of every route. */
export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: React.ReactNode;
}) {
  return (
    <header className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        <h1 className="text-[20px] leading-[26px] font-[650] tracking-[-0.018em] text-[var(--fg)]">
          {title}
        </h1>
        {description ? (
          <p className="mt-1 max-w-[62ch] text-[13px] leading-[19px] text-[var(--fg-muted)]">
            {description}
          </p>
        ) : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}
