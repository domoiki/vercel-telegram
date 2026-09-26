"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Activity,
  Bot,
  LayoutGrid,
  MessageSquare,
  MessagesSquare,
  Settings,
} from "lucide-react";

import { cn } from "@/lib/utils";

export const NAV_ITEMS = [
  { href: "/", label: "Overview", icon: LayoutGrid, match: (p: string) => p === "/" },
  { href: "/messages", label: "Messages", icon: MessageSquare, match: (p: string) => p.startsWith("/messages") },
  {
    href: "/conversations",
    label: "Conversations",
    icon: MessagesSquare,
    match: (p: string) => p.startsWith("/conversations"),
  },
  { href: "/providers", label: "AI Providers", icon: Bot, match: (p: string) => p.startsWith("/providers") },
  { href: "/logs", label: "Logs", icon: Activity, match: (p: string) => p.startsWith("/logs") },
  { href: "/settings", label: "Settings", icon: Settings, match: (p: string) => p.startsWith("/settings") },
] as const;

export function SidebarNav({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();

  return (
    <nav aria-label="Main" className="flex flex-col gap-0.5 p-2">
      {NAV_ITEMS.map((item) => {
        const active = item.match(pathname);
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            aria-current={active ? "page" : undefined}
            className={cn(
              "group relative flex h-8.5 items-center gap-2.5 rounded-[var(--radius-control)] px-2.5",
              "text-[13px] font-[500] transition-colors duration-120 outline-offset-2",
              "focus-visible:outline-2 focus-visible:outline-[var(--accent)]",
              active
                ? "bg-[var(--accent-wash)] text-[var(--fg)]"
                : "text-[var(--fg-muted)] hover:bg-[var(--surface-2)] hover:text-[var(--fg)]",
            )}
          >
            {/* The active marker is a lit segment on the rail, not a filled pill. */}
            <span
              aria-hidden
              className={cn(
                "absolute top-1/2 left-0 h-4 w-[2px] -translate-y-1/2 rounded-r-full bg-[var(--accent)] transition-opacity duration-120",
                active ? "opacity-100" : "opacity-0",
              )}
            />
            <Icon
              size={15}
              strokeWidth={1.8}
              className={cn("shrink-0", active ? "text-[var(--accent)]" : "text-[var(--fg-subtle)] group-hover:text-[var(--fg-muted)]")}
            />
            <span className="truncate">{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

export function SidebarFooter() {
  return (
    <div className="border-t border-[var(--line)] p-2">
      <p className="px-2.5 py-1.5 text-[11px] leading-4 text-[var(--fg-subtle)]">
        Personal gateway console. Configure everything from{" "}
        <Link
          href="/settings"
          className="text-[var(--fg-muted)] underline decoration-[var(--line-strong)] underline-offset-2 transition-colors hover:text-[var(--fg)]"
        >
          Settings
        </Link>
        .
      </p>
    </div>
  );
}

export function Wordmark() {
  return (
    <Link
      href="/"
      className="flex items-center gap-2.5 px-3 py-3 outline-offset-2 focus-visible:outline-2 focus-visible:outline-[var(--accent)]"
    >
      <span
        aria-hidden
        className="relative flex size-6 shrink-0 items-center justify-center rounded-[5px] border border-[var(--accent-line)] bg-[var(--accent-wash)]"
      >
        {/* A lit lamp: the product's one recurring signal motif. */}
        <span className="size-1.5 rounded-full bg-[var(--accent)] shadow-[0_0_0_3px_var(--accent-wash)]" />
      </span>
      <span className="min-w-0 leading-tight">
        <span className="block truncate text-[12.5px] font-[620] tracking-[-0.012em] text-[var(--fg)]">
          AI Gateway
        </span>
        <span className="block truncate text-[11px] font-[500] text-[var(--fg-subtle)]">
          Telegram console
        </span>
      </span>
    </Link>
  );
}
