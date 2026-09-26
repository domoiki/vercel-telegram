"use client";

import { createContext, useCallback, useContext, useMemo, useState } from "react";
import { AlertTriangle, Check, Info, X } from "lucide-react";
import { cn } from "@/lib/utils";

type ToastTone = "success" | "error" | "info";
type Toast = { id: number; tone: ToastTone; message: string; detail?: string };

const ToastContext = createContext<{
  push: (tone: ToastTone, message: string, detail?: string) => void;
} | null>(null);

let counter = 0;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const remove = useCallback((id: number) => {
    setToasts((current) => current.filter((t) => t.id !== id));
  }, []);

  const push = useCallback(
    (tone: ToastTone, message: string, detail?: string) => {
      counter += 1;
      const id = counter;
      setToasts((current) => [...current.slice(-3), { id, tone, message, detail }]);
      window.setTimeout(() => remove(id), tone === "error" ? 7000 : 4000);
    },
    [remove],
  );

  const value = useMemo(() => ({ push }), [push]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        aria-live="polite"
        aria-atomic="false"
        className="pointer-events-none fixed inset-x-0 bottom-0 z-50 flex flex-col items-center gap-2 p-4 sm:inset-x-auto sm:right-4 sm:bottom-4 sm:items-end"
      >
        {toasts.map((toast) => (
          <div
            key={toast.id}
            role="status"
            className={cn(
              "glass glass-lit pointer-events-auto flex w-full max-w-sm items-start gap-2.5 rounded-[var(--radius-panel)] px-3 py-2.5",
              "shadow-[var(--shadow-pop)]",
            )}
            style={{
              borderColor:
                toast.tone === "success"
                  ? "var(--line)"
                  : toast.tone === "error"
                    ? "var(--error-line, var(--error))"
                    : "var(--line)",
            }}
          >
            <span className="mt-px shrink-0">
              {toast.tone === "success" ? (
                <Check size={14} className="text-[var(--success)]" strokeWidth={2.4} />
              ) : toast.tone === "error" ? (
                <AlertTriangle size={14} className="text-[var(--error)]" strokeWidth={2.2} />
              ) : (
                <Info size={14} className="text-[var(--info)]" strokeWidth={2.2} />
              )}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[12.5px] leading-[17px] font-[550] text-[var(--fg)]">
                {toast.message}
              </p>
              {toast.detail ? (
                <p className="mt-0.5 font-[var(--font-mono)] text-[11px] leading-[15px] break-words text-[var(--fg-muted)]">
                  {toast.detail}
                </p>
              ) : null}
            </div>
            <button
              type="button"
              onClick={() => remove(toast.id)}
              aria-label="Dismiss notification"
              className="-mt-0.5 -mr-1 rounded p-1 text-[var(--fg-subtle)] transition-colors hover:text-[var(--fg)] focus-visible:outline-2 focus-visible:outline-[var(--accent)]"
            >
              <X size={12} strokeWidth={2.2} />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) {
    // Rendering outside a provider should not crash a page.
    return { push: () => undefined } as const;
  }
  return context;
}
