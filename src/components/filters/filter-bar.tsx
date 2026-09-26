"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Loader2, Search, X } from "lucide-react";

import { Select } from "@/components/ui/field";
import { cn } from "@/lib/utils";

/**
 * URL-backed filter controls.
 *
 * Every filter lives in the query string, so a filtered view is a shareable,
 * reload-safe URL and the server does the filtering.
 */
export function FilterBar({
  searchPlaceholder = "Search",
  children,
  className,
}: {
  searchPlaceholder?: string;
  children?: React.ReactNode;
  className?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();
  const [term, setTerm] = useState(params.get("q") ?? "");
  const [dirty, setDirty] = useState(false);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const initialized = useRef(false);

  // Keep the field in sync when the user navigates back/forward.
  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;
    setTerm(params.get("q") ?? "");
  }, [params]);

  const apply = useCallback(
    (updates: Record<string, string | null>) => {
      const next = new URLSearchParams(params.toString());
      for (const [key, value] of Object.entries(updates)) {
        if (value === null || value === "") next.delete(key);
        else next.set(key, value);
      }
      next.delete("page");
      startTransition(() => {
        router.replace(`${pathname}?${next.toString()}`, { scroll: false });
      });
    },
    [params, pathname, router],
  );

  // Debounced so typing does not push a history entry per keystroke.
  useEffect(() => {
    if (!dirty) return;
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(() => {
      apply({ q: term || null });
      setDirty(false);
    }, 280);
    return () => {
      if (debounce.current) clearTimeout(debounce.current);
    };
  }, [term, dirty, apply]);

  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-2 border-b border-[var(--line)] bg-[var(--surface-2)] px-3 py-2.5",
        className,
      )}
    >
      <div className="relative min-w-0 flex-1 sm:max-w-xs">
        <Search
          size={13}
          strokeWidth={2}
          aria-hidden
          className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-[var(--fg-subtle)]"
        />
        <input
          type="search"
          value={term}
          onChange={(event) => {
            setTerm(event.target.value);
            setDirty(true);
          }}
          placeholder={searchPlaceholder}
          aria-label={searchPlaceholder}
          className={cn(
            "h-8 w-full rounded-[var(--radius-control)] border border-[var(--line-strong)] bg-[var(--surface)] pr-7 pl-8 text-[12.5px] text-[var(--fg)]",
            "placeholder:text-[var(--fg-subtle)] outline-offset-1",
            "focus:border-[var(--accent)] focus:outline-2 focus:outline-[var(--accent)]/30",
            "[&::-webkit-search-cancel-button]:appearance-none",
          )}
        />
        {term ? (
          <button
            type="button"
            onClick={() => {
              setTerm("");
              setDirty(true);
            }}
            aria-label="Clear search"
            className="absolute top-1/2 right-2 -translate-y-1/2 rounded p-0.5 text-[var(--fg-subtle)] transition-colors hover:text-[var(--fg)] focus-visible:outline-2 focus-visible:outline-[var(--accent)]"
          >
            <X size={12} strokeWidth={2.2} />
          </button>
        ) : null}
      </div>

      {children}

      <div className="ml-auto flex items-center gap-2">
        {pending ? (
          <Loader2
            size={13}
            className="animate-spin text-[var(--fg-subtle)]"
            aria-label="Updating"
          />
        ) : null}
        <FilterSelect
          label="Status"
          paramKey="status"
          value={params.get("status") ?? "all"}
          onChange={(value) => apply({ status: value === "all" ? null : value })}
          options={[
            { value: "all", label: "All statuses" },
            { value: "delivered", label: "Delivered" },
            { value: "failed", label: "Failed" },
            { value: "processing", label: "Processing" },
            { value: "received", label: "Received" },
            { value: "skipped", label: "Skipped" },
          ]}
        />
      </div>
    </div>
  );
}

export function FilterSelect({
  label,
  paramKey,
  value,
  onChange,
  options,
  className,
  width = "w-auto",
}: {
  label: string;
  paramKey: string;
  value: string;
  /** Optional: the URL is updated on change even when this is omitted. */
  onChange?: (value: string) => void;
  options: Array<{ value: string; label: string }>;
  className?: string;
  width?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  return (
    <Select
      aria-label={label}
      title={label}
      value={value}
      onChange={(event) => {
        const nextValue = event.target.value;
        onChange?.(nextValue);
        const next = new URLSearchParams(params.toString());
        if (nextValue === "all" || nextValue === "") next.delete(paramKey);
        else next.set(paramKey, nextValue);
        next.delete("page");
        router.replace(`${pathname}?${next.toString()}`, { scroll: false });
      }}
      className={cn("h-8 text-[12px]", width, className)}
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </Select>
  );
}

export function DateRangeFilter() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const from = params.get("from") ?? "";
  const to = params.get("to") ?? "";

  const update = (key: string, value: string) => {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    next.delete("page");
    router.replace(`${pathname}?${next.toString()}`, { scroll: false });
  };

  return (
    <div className="flex items-center gap-1.5">
      <label className="sr-only" htmlFor="filter-from">
        From date
      </label>
      <input
        id="filter-from"
        type="date"
        value={from}
        onChange={(event) => update("from", event.target.value)}
        className="h-8 w-[136px] rounded-[var(--radius-control)] border border-[var(--line-strong)] bg-[var(--surface)] px-2 font-[var(--font-mono)] text-[11.5px] text-[var(--fg)] outline-offset-1 focus:border-[var(--accent)] focus:outline-2 focus:outline-[var(--accent)]/30"
      />
      <span aria-hidden className="text-[var(--fg-subtle)]">
        —
      </span>
      <label className="sr-only" htmlFor="filter-to">
        To date
      </label>
      <input
        id="filter-to"
        type="date"
        value={to}
        onChange={(event) => update("to", event.target.value)}
        className="h-8 w-[136px] rounded-[var(--radius-control)] border border-[var(--line-strong)] bg-[var(--surface)] px-2 font-[var(--font-mono)] text-[11.5px] text-[var(--fg)] outline-offset-1 focus:border-[var(--accent)] focus:outline-2 focus:outline-[var(--accent)]/30"
      />
    </div>
  );
}

export function Pagination({
  page,
  perPage,
  total,
  className,
}: {
  page: number;
  perPage: number;
  total: number;
  className?: string;
}) {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const totalPages = Math.max(1, Math.ceil(total / perPage));
  const from = total === 0 ? 0 : (page - 1) * perPage + 1;
  const to = Math.min(page * perPage, total);

  const go = (nextPage: number) => {
    const next = new URLSearchParams(params.toString());
    if (nextPage <= 1) next.delete("page");
    else next.set("page", String(nextPage));
    router.replace(`${pathname}?${next.toString()}`, { scroll: false });
  };

  return (
    <div
      className={cn(
        "flex flex-wrap items-center justify-between gap-2 border-t border-[var(--line)] bg-[var(--surface-2)] px-3 py-2",
        className,
      )}
    >
      <p className="tnum font-[var(--font-mono)] text-[11px] text-[var(--fg-subtle)]">
        {from}–{to} of {total.toLocaleString()}
      </p>
      <div className="flex items-center gap-1.5">
        <PagerButton disabled={page <= 1} onClick={() => go(page - 1)}>
          Previous
        </PagerButton>
        <span className="tnum px-1 font-[var(--font-mono)] text-[11.5px] text-[var(--fg-muted)]">
          {page} / {totalPages}
        </span>
        <PagerButton disabled={page >= totalPages} onClick={() => go(page + 1)}>
          Next
        </PagerButton>
      </div>
    </div>
  );
}

function PagerButton({
  children,
  disabled,
  onClick,
}: {
  children: React.ReactNode;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "h-7 rounded-[var(--radius-control)] border border-[var(--line-strong)] px-2.5 text-[12px] font-[550] text-[var(--fg)] transition-colors",
        "hover:bg-[var(--surface-3)] focus-visible:outline-2 focus-visible:outline-[var(--accent)] focus-visible:outline-offset-2",
        "disabled:pointer-events-none disabled:opacity-40",
      )}
    >
      {children}
    </button>
  );
}
