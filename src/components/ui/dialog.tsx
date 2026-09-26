"use client";

import { useEffect, useId, useRef } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Native <dialog> gives focus trapping, Escape-to-close and inertness for free,
 * which is most of what an accessible modal needs.
 */
export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = "md",
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  size?: "sm" | "md" | "lg";
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descId = useId();

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    if (open && !node.open) node.showModal();
    if (!open && node.open) node.close();
  }, [open]);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const onCancel = (event: Event) => {
      event.preventDefault();
      onClose();
    };
    node.addEventListener("cancel", onCancel);
    return () => node.removeEventListener("cancel", onCancel);
  }, [onClose]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      aria-describedby={description ? descId : undefined}
      className={cn(
        "m-auto w-[calc(100vw-2rem)] border border-[var(--line-strong)] bg-[var(--surface)] p-0 text-[var(--fg)]",
        "rounded-[var(--radius-dialog)] shadow-[var(--shadow-pop)] backdrop:bg-black/45 backdrop:backdrop-blur-[2px]",
        "open:animate-none",
        size === "sm" && "max-w-md",
        size === "md" && "max-w-xl",
        size === "lg" && "max-w-3xl",
      )}
      onClick={(event) => {
        // Click on the backdrop (outside the dialog's own box) closes it.
        if (event.target === ref.current) onClose();
      }}
    >
      <div className="flex items-start justify-between gap-4 border-b border-[var(--line)] px-5 py-3.5">
        <div className="min-w-0">
          <h2
            id={titleId}
            className="text-[14.5px] leading-5 font-[620] tracking-[-0.01em]"
          >
            {title}
          </h2>
          {description ? (
            <p id={descId} className="mt-0.5 text-[12.5px] leading-[18px] text-[var(--fg-muted)]">
              {description}
            </p>
          ) : null}
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close dialog"
          className="-mt-0.5 -mr-1 rounded-[var(--radius-control)] p-1.5 text-[var(--fg-subtle)] outline-offset-2 transition-colors hover:bg-[var(--surface-2)] hover:text-[var(--fg)] focus-visible:outline-2 focus-visible:outline-[var(--accent)]"
        >
          <X size={15} strokeWidth={2} />
        </button>
      </div>

      <div className="max-h-[min(70vh,640px)] overflow-y-auto px-5 py-4">{children}</div>

      {footer ? (
        <div className="flex items-center justify-end gap-2 border-t border-[var(--line)] bg-[var(--surface-2)] px-5 py-3">
          {footer}
        </div>
      ) : null}
    </dialog>
  );
}

export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  description,
  confirmLabel = "Delete",
  destructive = true,
  busy = false,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  description: string;
  confirmLabel?: string;
  destructive?: boolean;
  busy?: boolean;
}) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title}
      size="sm"
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            className="h-8.5 rounded-[var(--radius-control)] border border-[var(--line-strong)] px-3 text-[13px] font-[550] text-[var(--fg)] transition-colors hover:bg-[var(--surface-2)] focus-visible:outline-2 focus-visible:outline-[var(--accent)] focus-visible:outline-offset-2"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className={cn(
              "h-8.5 rounded-[var(--radius-control)] px-3 text-[13px] font-[550] transition-colors focus-visible:outline-2 focus-visible:outline-[var(--accent)] focus-visible:outline-offset-2 disabled:opacity-50",
              destructive
                ? "bg-[var(--error)] text-white hover:brightness-110"
                : "bg-[var(--accent)] text-[var(--accent-fg)] hover:bg-[var(--accent-hover)]",
            )}
          >
            {busy ? "Working…" : confirmLabel}
          </button>
        </>
      }
    >
      <p className="text-[13px] leading-5 text-[var(--fg-muted)]">{description}</p>
    </Dialog>
  );
}
