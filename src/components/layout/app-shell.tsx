"use client";

import { useEffect, useState } from "react";

import { SidebarFooter, SidebarNav, Wordmark } from "@/components/layout/sidebar";
import { Topbar } from "@/components/layout/topbar";
import { ToastProvider } from "@/components/ui/toast";
import type { HealthState } from "@/lib/health-types";

export function AppShell({
  health,
  children,
}: {
  health: {
    database: { state: HealthState; detail: string };
    telegram: { state: HealthState; detail: string };
    providers: { state: HealthState; detail: string };
  };
  children: React.ReactNode;
}) {
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menuOpen]);

  return (
    <ToastProvider>
      <div className="flex min-h-dvh">
        <a href="#main" className="skip-link">
          Skip to content
        </a>

        {/* Desktop rail: a fixed panel, not a floating island. */}
        <aside className="fixed inset-y-0 left-0 z-40 hidden w-[212px] flex-col border-r border-[var(--line)] bg-[var(--bg-elevated)] lg:flex">
          <div className="border-b border-[var(--line)]">
            <Wordmark />
          </div>
          <div className="flex-1 overflow-y-auto py-2">
            <SidebarNav />
          </div>
          <SidebarFooter />
        </aside>

        {/* Mobile drawer */}
        {menuOpen ? (
          <div className="fixed inset-0 z-40 lg:hidden">
            <button
              type="button"
              aria-label="Close navigation"
              onClick={() => setMenuOpen(false)}
              className="absolute inset-0 bg-black/50"
            />
            <aside
              id="primary-navigation"
              className="absolute inset-y-0 left-0 flex w-[248px] flex-col border-r border-[var(--line-strong)] bg-[var(--bg-elevated)] shadow-[var(--shadow-pop)]"
            >
              <div className="border-b border-[var(--line)]">
                <Wordmark />
              </div>
              <div className="flex-1 overflow-y-auto py-2">
                <SidebarNav onNavigate={() => setMenuOpen(false)} />
              </div>
              <SidebarFooter />
            </aside>
          </div>
        ) : (
          <div id="primary-navigation" className="hidden" />
        )}

        <div className="flex min-w-0 flex-1 flex-col lg:pl-[212px]">
          <Topbar
            menuOpen={menuOpen}
            onToggleMenu={() => setMenuOpen((open) => !open)}
            health={health}
          />
          <main id="main" className="min-w-0 flex-1 px-3 py-5 sm:px-5 sm:py-6 lg:px-7">
            <div className="mx-auto w-full max-w-[1400px]">{children}</div>
          </main>
        </div>
      </div>
    </ToastProvider>
  );
}
