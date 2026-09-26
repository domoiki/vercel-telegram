import { cn } from "@/lib/utils";

/** Tables are the densest surface in the product, so the rules are explicit. */
export function TableWrap({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("w-full overflow-x-auto", className)}>
      <table className="w-full min-w-[640px] border-collapse text-left">{children}</table>
    </div>
  );
}

export function Th({
  children,
  className,
  align = "left",
  ...props
}: React.ThHTMLAttributes<HTMLTableCellElement> & { align?: "left" | "right" | "center" }) {
  return (
    <th
      scope="col"
      className={cn(
        "border-b border-[var(--line)] bg-[var(--surface-2)] px-3 py-2",
        "font-[var(--font-mono)] text-[10.5px] leading-4 font-[500] tracking-[0.06em] text-[var(--fg-subtle)] uppercase",
        "whitespace-nowrap",
        align === "right" && "text-right",
        align === "center" && "text-center",
        className,
      )}
      {...props}
    >
      {children}
    </th>
  );
}

export function Td({
  children,
  className,
  align = "left",
  ...props
}: React.TdHTMLAttributes<HTMLTableCellElement> & { align?: "left" | "right" | "center" }) {
  return (
    <td
      className={cn(
        "border-b border-[var(--line-faint)] px-3 py-2.5 align-middle text-[12.5px] text-[var(--fg)]",
        align === "right" && "text-right",
        align === "center" && "text-center",
        className,
      )}
      {...props}
    >
      {children}
    </td>
  );
}

export function Tr({
  children,
  className,
  ...props
}: React.HTMLAttributes<HTMLTableRowElement>) {
  return (
    <tr
      // `relative` lets a cell's link carry a stretched hit area, so the whole
      // row is clickable without nesting anchors around table rows.
      className={cn("relative transition-colors duration-100 hover:bg-[var(--surface-2)]", className)}
      {...props}
    >
      {children}
    </tr>
  );
}

export function EmptyState({
  title,
  description,
  action,
  icon,
  className,
}: {
  title: string;
  description: React.ReactNode;
  action?: React.ReactNode;
  icon?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center px-6 py-12 text-center", className)}>
      {icon ? (
        <div className="mb-3 flex size-9 items-center justify-center rounded-[var(--radius-control)] border border-[var(--line)] bg-[var(--surface-2)] text-[var(--fg-subtle)]">
          {icon}
        </div>
      ) : null}
      <p className="text-[13.5px] font-[600] text-[var(--fg)]">{title}</p>
      <p className="mt-1 max-w-[46ch] text-[12.5px] leading-[18px] text-[var(--fg-muted)]">
        {description}
      </p>
      {action ? <div className="mt-4 flex items-center gap-2">{action}</div> : null}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={cn("animate-pulse rounded-[4px] bg-[var(--surface-3)]", className)}
    />
  );
}
