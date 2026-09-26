"use client";

import { useEffect, useState } from "react";
import { useTheme } from "next-themes";
import { Check, Monitor, Moon, Sun } from "lucide-react";

import { useToast } from "@/components/ui/toast";
import { ApiError, apiFetch } from "@/lib/client-api";
import type { ThemePreference } from "@/lib/settings-defaults";
import { cn } from "@/lib/utils";

const OPTIONS: Array<{
  value: ThemePreference;
  label: string;
  description: string;
  icon: typeof Sun;
}> = [
  { value: "light", label: "Light", description: "Cool instrument paper", icon: Sun },
  { value: "dark", label: "Dark", description: "Warm graphite console", icon: Moon },
  { value: "system", label: "System", description: "Follow the operating system", icon: Monitor },
];

export function AppearanceSettings({ initial }: { initial: ThemePreference }) {
  const { theme, setTheme } = useTheme();
  const toast = useToast();
  const [mounted, setMounted] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => setMounted(true), []);

  async function choose(value: ThemePreference) {
    setTheme(value);
    setSaving(true);
    try {
      await apiFetch("/api/settings", {
        method: "PATCH",
        body: JSON.stringify({ defaultTheme: value }),
      });
      toast.push("success", "Theme preference saved");
    } catch (error) {
      toast.push(
        "error",
        "Could not save the theme preference",
        error instanceof ApiError ? error.message : undefined,
      );
    } finally {
      setSaving(false);
    }
  }

  const active = mounted ? (theme as ThemePreference) : initial;

  return (
    <div className="grid gap-2.5 p-4 sm:grid-cols-3">
      {OPTIONS.map((option) => {
        const Icon = option.icon;
        const selected = active === option.value;
        return (
          <button
            key={option.value}
            type="button"
            onClick={() => choose(option.value)}
            aria-pressed={selected}
            disabled={saving}
            className={cn(
              "flex flex-col items-start gap-2 rounded-[var(--radius-control)] border p-3 text-left transition-colors",
              "focus-visible:outline-2 focus-visible:outline-[var(--accent)] focus-visible:outline-offset-2",
              "disabled:opacity-60",
              selected
                ? "border-[var(--accent)] bg-[var(--accent-wash)]"
                : "border-[var(--line-strong)] bg-[var(--surface)] hover:bg-[var(--surface-2)]",
            )}
          >
            <span className="flex w-full items-center justify-between">
              <Icon
                size={15}
                strokeWidth={1.9}
                className={selected ? "text-[var(--accent)]" : "text-[var(--fg-muted)]"}
              />
              {selected ? (
                <Check size={13} strokeWidth={2.6} className="text-[var(--accent)]" />
              ) : null}
            </span>
            <span>
              <span className="block text-[12.5px] font-[600] text-[var(--fg)]">{option.label}</span>
              <span className="mt-0.5 block text-[11.5px] leading-4 text-[var(--fg-muted)]">
                {option.description}
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
