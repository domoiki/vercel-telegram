import { cn } from "@/lib/utils";

type Variant = "primary" | "secondary" | "ghost" | "danger" | "quiet";
type Size = "sm" | "md";

const VARIANTS: Record<Variant, string> = {
  primary:
    "bg-[var(--accent)] text-[var(--accent-fg)] hover:bg-[var(--accent-hover)] border border-transparent shadow-[0_1px_2px_rgba(0,0,0,0.16)]",
  secondary:
    "bg-[var(--surface)] text-[var(--fg)] border border-[var(--line-strong)] hover:bg-[var(--surface-2)]",
  ghost:
    "bg-transparent text-[var(--fg-muted)] border border-transparent hover:bg-[var(--surface-2)] hover:text-[var(--fg)]",
  danger:
    "bg-transparent text-[var(--error)] border border-[var(--line)] hover:bg-[var(--error-wash)] hover:border-[var(--error)]/40",
  quiet:
    "bg-[var(--surface-3)] text-[var(--fg-muted)] border border-transparent hover:text-[var(--fg)]",
};

const SIZES: Record<Size, string> = {
  sm: "h-7 px-2.5 text-[12px] gap-1.5",
  md: "h-8.5 px-3 text-[13px] gap-2",
};

export function buttonClass({
  variant = "secondary",
  size = "md",
  className,
}: {
  variant?: Variant;
  size?: Size;
  className?: string;
} = {}) {
  return cn(
    "inline-flex shrink-0 items-center justify-center rounded-[var(--radius-control)] font-[550] whitespace-nowrap",
    "transition-colors duration-120 outline-offset-2",
    "focus-visible:outline-2 focus-visible:outline-[var(--accent)]",
    "disabled:pointer-events-none disabled:opacity-45",
    VARIANTS[variant],
    SIZES[size],
    className,
  );
}

export type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: Size;
};

export function Button({ variant, size, className, type, ...props }: ButtonProps) {
  return (
    <button
      type={type ?? "button"}
      className={buttonClass({ variant, size, className })}
      {...props}
    />
  );
}
