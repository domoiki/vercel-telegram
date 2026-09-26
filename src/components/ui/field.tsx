"use client";

import { useId } from "react";
import { cn } from "@/lib/utils";

const CONTROL =
  "w-full rounded-[var(--radius-control)] border border-[var(--line-strong)] bg-[var(--surface)] px-2.5 text-[13px] text-[var(--fg)] " +
  "placeholder:text-[var(--fg-subtle)] transition-colors duration-120 outline-offset-2 " +
  "focus:border-[var(--accent)] focus:outline-2 focus:outline-[var(--accent)]/35 focus:outline-offset-0 " +
  "disabled:opacity-50 disabled:cursor-not-allowed";

export function Field({
  label,
  hint,
  error,
  required,
  children,
  htmlFor,
  className,
}: {
  label: string;
  hint?: React.ReactNode;
  error?: string | null;
  required?: boolean;
  children: React.ReactNode;
  htmlFor?: string;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <label
        htmlFor={htmlFor}
        className="flex items-baseline gap-1.5 text-[12px] leading-4 font-[550] text-[var(--fg)]"
      >
        {label}
        {required ? (
          <span className="text-[var(--error)]" aria-hidden>
            *
          </span>
        ) : null}
      </label>
      {children}
      {error ? (
        <p className="text-[11.5px] leading-4 text-[var(--error)]">{error}</p>
      ) : hint ? (
        <p className="text-[11.5px] leading-4 text-[var(--fg-subtle)]">{hint}</p>
      ) : null}
    </div>
  );
}

export function Input({
  className,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn(CONTROL, "h-8.5", className)} {...props} />;
}

export function Textarea({
  className,
  ...props
}: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={cn(CONTROL, "resize-y py-1.5 leading-[19px]", className)}
      {...props}
    />
  );
}

export function Select({
  className,
  children,
  ...props
}: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={cn(
        CONTROL,
        "h-8.5 cursor-pointer appearance-none bg-no-repeat pr-7",
        className,
      )}
      style={{
        backgroundImage:
          "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath d='M2.5 4.5L6 8l3.5-3.5' fill='none' stroke='%23888f99' stroke-width='1.4' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E\")",
        backgroundPosition: "right 8px center",
      }}
      {...props}
    >
      {children}
    </select>
  );
}

export function Switch({
  checked,
  onChange,
  label,
  description,
  disabled,
  id: providedId,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
  description?: string;
  disabled?: boolean;
  id?: string;
}) {
  const generatedId = useId();
  const id = providedId ?? generatedId;
  return (
    <button
      type="button"
      role="switch"
      id={id}
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        // The label, description and track are one control, so the whole row is
        // the tap target rather than an 18px toggle in the corner.
        "flex w-full items-start justify-between gap-4 rounded-[var(--radius-control)] py-2 pr-1 text-left",
        "transition-colors duration-120 outline-offset-2",
        "focus-visible:outline-2 focus-visible:outline-[var(--accent)]",
        "hover:bg-[var(--surface-2)]",
        disabled && "cursor-not-allowed opacity-50",
      )}
    >
      <span className="min-w-0">
        <span className="block text-[13px] leading-[18px] font-[550] text-[var(--fg)]">
          {label}
        </span>
        {description ? (
          <span className="mt-0.5 block text-[11.5px] leading-[16px] text-[var(--fg-muted)]">
            {description}
          </span>
        ) : null}
      </span>
      <span
        aria-hidden
        className={cn(
          "relative mt-0.5 h-[18px] w-[32px] shrink-0 rounded-full border transition-colors duration-150",
          checked
            ? "border-transparent bg-[var(--accent)]"
            : "border-[var(--line-strong)] bg-[var(--surface-3)]",
        )}
      >
        <span
          className={cn(
            "absolute top-[2px] size-[12px] rounded-full transition-[left] duration-150 ease-[var(--ease-console)]",
            checked ? "left-[16px] bg-[var(--accent-fg)]" : "left-[2px] bg-[var(--fg-subtle)]",
          )}
        />
      </span>
    </button>
  );
}

/** Segmented control — used for filters and the theme picker. */
export function Segmented<T extends string>({
  value,
  onChange,
  options,
  size = "md",
  className,
  label,
}: {
  value: T;
  onChange: (value: T) => void;
  options: Array<{ value: T; label: React.ReactNode }>;
  size?: "sm" | "md";
  className?: string;
  label?: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cn(
        "inline-flex items-center gap-0.5 rounded-[var(--radius-control)] border border-[var(--line)] bg-[var(--surface-inset)] p-0.5",
        className,
      )}
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(option.value)}
            className={cn(
              "rounded-[4px] font-[550] transition-colors duration-120 outline-offset-1",
              "focus-visible:outline-2 focus-visible:outline-[var(--accent)]",
              size === "sm" ? "h-6 px-2 text-[11.5px]" : "h-7 px-2.5 text-[12px]",
              active
                ? "bg-[var(--surface)] text-[var(--fg)] shadow-[var(--shadow-panel)]"
                : "text-[var(--fg-muted)] hover:text-[var(--fg)]",
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
