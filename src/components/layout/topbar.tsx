"use client";

import { useEffect, useState } from "react";
import { useTheme } from "next-themes";
import { Check, Menu, Monitor, Moon, Sun, X } from "lucide-react";

import { StatusDot } from "@/components/ui/badge";
import type { Tone } from "@/components/ui/badge";
import { healthTone } from "@/lib/status";
import { cn } from "@/lib/utils";
import type { HealthState } from "@/lib/health-types";

const THEME_OPTIONS = [
  { value: "light", label: "Light", icon: Sun },
  { value: "system", label: "System", icon: Monitor },
  { value: "dark", label: "Dark", icon: Moon },
] as const;

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  if (!mounted) {
    return <div className="h-7 w-[74px] rounded-[var(--radius-control)] border border-[var(--line)]" />;
  }

  return (
    <div
      role="radiogroup"
      aria-label="Colour theme"
      className="flex items-center gap-0.5 rounded-[var(--radius-control)] border border-[var(--line)] bg-[var(--surface-inset)] p-0.5"
    >
      {THEME_OPTIONS.map((option) => {
        const active = theme === option.value;
        const Icon = option.icon;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={active}
            title={`${option.label} theme`}
            onClick={() => setTheme(option.value)}
            className={cn(
              "flex size-6 items-center justify-center rounded-[4px] transition-colors duration-120 outline-offset-1",
              "focus-visible:outline-2 focus-visible:outline-[var(--accent)]",
              active
                ? "bg-[var(--surface)] text-[var(--fg)] shadow-[var(--shadow-panel)]"
                : "text-[var(--fg-subtle)] hover:text-[var(--fg-muted)]",
            )}
          >
            <Icon size={13} strokeWidth={1.9} />
            <span className="sr-only">{option.label}</span>
          </button>
        );
      })}
    </div>
  );
}

function HealthPill({
  label,
  state,
  title,
}: {
  label: string;
  state: HealthState;
  title: string;
}) {
  const tone: Tone = healthTone(state);
  return (
    <span
      title={title}
      className="hidden items-center gap-1.5 rounded-full border border-[var(--line)] bg-[var(--surface-2)] px-2 py-[3px] text-[11px] font-[500] text-[var(--fg-muted)] sm:inline-flex"
    >
      <StatusDot tone={tone} pulse={state === "ok"} />
      {label}
    </span>
  );
}

export function Topbar({
  menuOpen,
  onToggleMenu,
  health,
}: {
  menuOpen: boolean;
  onToggleMenu: () => void;
  health: {
    database: { state: HealthState; detail: string };
    telegram: { state: HealthState; detail: string };
    providers: { state: HealthState; detail: string };
  };
}) {
  return (
    <header className="glass glass-lit sticky top-0 z-30 flex h-12 items-center gap-3 border-x-0 border-t-0 px-3 sm:px-4">
      <button
        type="button"
        onClick={onToggleMenu}
        aria-expanded={menuOpen}
        aria-controls="primary-navigation"
        aria-label={menuOpen ? "Close navigation" : "Open navigation"}
        className="-ml-1 flex size-8 items-center justify-center rounded-[var(--radius-control)] text-[var(--fg-muted)] transition-colors hover:bg-[var(--surface-2)] hover:text-[var(--fg)] focus-visible:outline-2 focus-visible:outline-[var(--accent)] lg:hidden"
      >
        {menuOpen ? <X size={16} strokeWidth={2} /> : <Menu size={16} strokeWidth={2} />}
      </button>

      <div className="flex flex-1 items-center gap-1.5 overflow-x-auto">
        <HealthPill label="Database" state={health.database.state} title={health.database.detail} />
        <HealthPill label="Telegram" state={health.telegram.state} title={health.telegram.detail} />
        <HealthPill
          label="Providers"
          state={health.providers.state}
          title={health.providers.detail}
        />
      </div>

      <ThemeToggle />
    </header>
  );
}

export function SavedMark() {
  return (
    <span className="inline-flex items-center gap-1 text-[11.5px] text-[var(--success)]">
      <Check size={12} strokeWidth={2.4} />
      Saved
    </span>
  );
}
