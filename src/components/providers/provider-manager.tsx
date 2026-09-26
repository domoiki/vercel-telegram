"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, Pencil, Play, Plus, Star, Trash2, Zap } from "lucide-react";

import { ProviderFormDialog } from "@/components/providers/provider-form";
import { Badge, Chip, StatusDot } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";
import { ApiError, apiFetch, notifyAdminKeyRequired } from "@/lib/client-api";
import { formatDuration, relativeTime } from "@/lib/format";
import type { ProviderSummary } from "@/lib/providers/shared";
import { cn } from "@/lib/utils";

type AdapterMeta = { id: string; label: string; hint: string };

type TestResult = {
  ok: boolean;
  httpStatus: number | null;
  durationMs: number;
  errorMessage: string | null;
  errorCategory: string | null;
  model: string;
  sample: string | null;
};

export function ProviderManager({
  initialProviders,
  adapters,
}: {
  initialProviders: ProviderSummary[];
  adapters: AdapterMeta[];
}) {
  const router = useRouter();
  const toast = useToast();
  const [, startTransition] = useTransition();

  const [providers, setProviders] = useState(initialProviders);
  const [editing, setEditing] = useState<ProviderSummary | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [deleting, setDeleting] = useState<ProviderSummary | null>(null);
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, TestResult>>({});

  function refresh() {
    startTransition(async () => {
      router.refresh();
    });
  }

  async function reloadFromApi() {
    try {
      const data = await apiFetch<{ providers: ProviderSummary[] }>("/api/providers");
      setProviders(data.providers);
    } catch {
      refresh();
    }
  }

  function handleApiError(error: unknown, fallback: string) {
    if (error instanceof ApiError && error.status === 401) {
      notifyAdminKeyRequired();
      toast.push(
        "error",
        "Admin key required",
        "Set ADMIN_API_KEY in your environment, then reopen this dialog and enter it.",
      );
      return;
    }
    toast.push(
      "error",
      fallback,
      error instanceof ApiError ? error.message : error instanceof Error ? error.message : undefined,
    );
  }

  async function testProvider(provider: ProviderSummary) {
    setTesting(provider.id);
    try {
      const data = await apiFetch<{ result: TestResult }>(`/api/providers/${provider.id}/test`, {
        method: "POST",
      });
      setResults((current) => ({ ...current, [provider.id]: data.result }));
      if (data.result.ok) {
        toast.push(
          "success",
          `${provider.name} responded`,
          `HTTP ${data.result.httpStatus} in ${formatDuration(data.result.durationMs)}`,
        );
      } else {
        toast.push(
          "error",
          `${provider.name} failed the test`,
          data.result.errorMessage ?? "No response",
        );
      }
      await reloadFromApi();
    } catch (error) {
      handleApiError(error, "Could not run the test");
    } finally {
      setTesting(null);
    }
  }

  async function mutate(
    provider: ProviderSummary,
    patch: Record<string, unknown>,
    successMessage: string,
  ) {
    setBusy(true);
    try {
      await apiFetch(`/api/providers/${provider.id}`, {
        method: "PATCH",
        body: JSON.stringify(patch),
      });
      toast.push("success", successMessage, provider.name);
      await reloadFromApi();
    } catch (error) {
      handleApiError(error, "Could not update the provider");
    } finally {
      setBusy(false);
    }
  }

  async function removeProvider() {
    if (!deleting) return;
    setBusy(true);
    try {
      await apiFetch(`/api/providers/${deleting.id}`, { method: "DELETE" });
      toast.push("success", "Provider deleted", deleting.name);
      setDeleting(null);
      await reloadFromApi();
    } catch (error) {
      handleApiError(error, "Could not delete the provider");
    } finally {
      setBusy(false);
    }
  }

  async function move(provider: ProviderSummary, direction: -1 | 1) {
    const order = providers.map((p) => p.id);
    const index = order.indexOf(provider.id);
    const target = index + direction;
    if (index === -1 || target < 0 || target >= order.length) return;
    const next = [...order];
    const a = next[index];
    const b = next[target];
    if (!a || !b) return;
    next[index] = b;
    next[target] = a;

    setProviders((current) => {
      const map = new Map(current.map((p) => [p.id, p]));
      return next.map((id) => map.get(id)).filter((p): p is ProviderSummary => Boolean(p));
    });

    try {
      const data = await apiFetch<{ providers: ProviderSummary[] }>("/api/providers/order", {
        method: "POST",
        body: JSON.stringify({ ids: next }),
      });
      setProviders(data.providers);
      toast.push("success", "Fallback order updated");
    } catch (error) {
      handleApiError(error, "Could not reorder providers");
      await reloadFromApi();
    }
  }

  return (
    <>
      <ul className="divide-y divide-[var(--line-faint)]">
        {providers.map((provider, index) => {
          const result = results[provider.id];
          const position = providers.filter((p) => p.enabled).findIndex((p) => p.id === provider.id);
          return (
            <li
              key={provider.id}
              className={cn(
                "px-4 py-3.5 transition-colors",
                !provider.enabled && "bg-[var(--surface-2)]/50",
              )}
            >
              <div className="flex flex-wrap items-start gap-x-3 gap-y-2">
                {/* Chain position: where this provider sits in the fallback order. */}
                <span
                  aria-hidden
                  className={cn(
                    "tnum mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-[5px] border font-[var(--font-mono)] text-[11px]",
                    provider.enabled
                      ? "border-[var(--accent-line)] bg-[var(--accent-wash)] text-[var(--accent)]"
                      : "border-[var(--line)] bg-[var(--surface-2)] text-[var(--fg-subtle)]",
                  )}
                  title={provider.enabled ? `Fallback position ${position + 1}` : "Disabled"}
                >
                  {provider.enabled ? position + 1 : "–"}
                </span>

                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <h3 className="truncate text-[13.5px] font-[600] text-[var(--fg)]">
                      {provider.name}
                    </h3>
                    {provider.isPrimary && provider.enabled ? (
                      <Badge tone="accent">
                        <Star size={9} strokeWidth={2.5} />
                        Primary
                      </Badge>
                    ) : null}
                    {!provider.enabled ? <Badge tone="neutral">Disabled</Badge> : null}
                    <Chip>{provider.adapter}</Chip>
                    <Chip title="Model">{provider.model}</Chip>
                  </div>

                  {provider.description ? (
                    <p className="mt-1 text-[12px] leading-[16px] text-[var(--fg-muted)]">
                      {provider.description}
                    </p>
                  ) : null}

                  <p className="mt-1 font-[var(--font-mono)] text-[11px] leading-[15px] break-all text-[var(--fg-subtle)]">
                    {provider.baseUrl}
                    {provider.hasApiKey ? (
                      <span className="ml-2 text-[var(--fg-subtle)]">
                        key {provider.apiKeyMask}
                      </span>
                    ) : (
                      <span className="ml-2 text-[var(--warning)]">no API key</span>
                    )}
                  </p>

                  <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
                    <HealthLine provider={provider} result={result} />
                  </div>
                </div>

                <div className="flex w-full flex-wrap items-center gap-1.5 sm:w-auto sm:shrink-0 sm:flex-nowrap">
                  <IconButton
                    label="Move earlier in the fallback chain"
                    disabled={busy || index === 0}
                    onClick={() => move(provider, -1)}
                  >
                    <ArrowUp size={13} strokeWidth={2} />
                  </IconButton>
                  <IconButton
                    label="Move later in the fallback chain"
                    disabled={busy || index === providers.length - 1}
                    onClick={() => move(provider, 1)}
                  >
                    <ArrowDown size={13} strokeWidth={2} />
                  </IconButton>
                  <Button
                    size="sm"
                    onClick={() => testProvider(provider)}
                    disabled={testing === provider.id}
                  >
                    {testing === provider.id ? (
                      <Zap size={12} className="animate-pulse" strokeWidth={2} />
                    ) : (
                      <Play size={11} strokeWidth={2.2} />
                    )}
                    {testing === provider.id ? "Testing" : "Test"}
                  </Button>
                  <Button
                    size="sm"
                    onClick={() => mutate(provider, { enabled: !provider.enabled }, provider.enabled ? "Provider disabled" : "Provider enabled")}
                    disabled={busy}
                  >
                    {provider.enabled ? "Disable" : "Enable"}
                  </Button>
                  <Button
                    size="sm"
                    onClick={() => {
                      setEditing(provider);
                      setFormOpen(true);
                    }}
                  >
                    <Pencil size={11} strokeWidth={2.2} />
                    Edit
                  </Button>
                  <Button
                    size="sm"
                    variant="danger"
                    onClick={() => setDeleting(provider)}
                    disabled={busy}
                    aria-label={`Delete ${provider.name}`}
                  >
                    <Trash2 size={11} strokeWidth={2.2} />
                  </Button>
                </div>
              </div>

              {result && !result.ok && result.errorMessage ? (
                <p className="mt-2 rounded-[var(--radius-control)] border border-[var(--error)]/30 bg-[var(--error-wash)] px-2.5 py-1.5 font-[var(--font-mono)] text-[11px] leading-[15px] text-[var(--error)]">
                  {result.errorMessage}
                </p>
              ) : null}
              {result?.ok && result.sample ? (
                <p className="mt-2 rounded-[var(--radius-control)] border border-[var(--line)] bg-[var(--surface-inset)] px-2.5 py-1.5 font-[var(--font-mono)] text-[11px] leading-[15px] text-[var(--fg-muted)]">
                  {result.sample}
                </p>
              ) : null}
            </li>
          );
        })}
      </ul>

      <ProviderFormDialog
        open={formOpen}
        onClose={() => setFormOpen(false)}
        adapters={adapters}
        provider={editing}
        onSaved={async () => {
          await reloadFromApi();
        }}
      />

      <ConfirmDialog
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        onConfirm={removeProvider}
        busy={busy}
        title={`Delete ${deleting?.name ?? "provider"}?`}
        description="The provider is removed from the fallback chain. Messages it already produced keep their recorded provider name, so history stays intact."
      />

      <div className="border-t border-[var(--line)] bg-[var(--surface-2)] px-4 py-2.5">
        <Button
          variant="primary"
          size="sm"
          onClick={() => {
            setEditing(null);
            setFormOpen(true);
          }}
        >
          <Plus size={12} strokeWidth={2.4} />
          Add provider
        </Button>
      </div>
    </>
  );
}

function HealthLine({ provider, result }: { provider: ProviderSummary; result?: TestResult }) {
  if (result) {
    return (
      <span className="inline-flex items-center gap-1.5 text-[11.5px]">
        <StatusDot tone={result.ok ? "success" : "error"} />
        <span className={result.ok ? "text-[var(--success)]" : "text-[var(--error)]"}>
          {result.ok ? "Test passed" : "Test failed"}
        </span>
        <span className="tnum font-[var(--font-mono)] text-[var(--fg-subtle)]">
          {result.httpStatus !== null ? `HTTP ${result.httpStatus} · ` : ""}
          {formatDuration(result.durationMs)}
        </span>
      </span>
    );
  }
  if (!provider.enabled) {
    return (
      <span className="text-[11.5px] text-[var(--fg-subtle)]">Not in the active chain</span>
    );
  }
  if (!provider.lastTestedAt) {
    return (
      <span className="inline-flex items-center gap-1.5 text-[11.5px] text-[var(--fg-subtle)]">
        <StatusDot tone="neutral" />
        Never tested
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-[11.5px]">
      <StatusDot tone={provider.lastTestOk ? "success" : "error"} />
      <span className={provider.lastTestOk ? "text-[var(--fg-muted)]" : "text-[var(--error)]"}>
        Last test {provider.lastTestOk ? "passed" : "failed"}
      </span>
      <span className="tnum font-[var(--font-mono)] text-[var(--fg-subtle)]">
        {relativeTime(provider.lastTestedAt)}
        {provider.lastTestLatencyMs !== null ? ` · ${formatDuration(provider.lastTestLatencyMs)}` : ""}
        {provider.lastTestHttpStatus !== null ? ` · HTTP ${provider.lastTestHttpStatus}` : ""}
      </span>
    </span>
  );
}

function IconButton({
  children,
  label,
  onClick,
  disabled,
}: {
  children: React.ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className={cn(
        "flex size-7 items-center justify-center rounded-[var(--radius-control)] border border-[var(--line-strong)] text-[var(--fg-muted)] transition-colors",
        "hover:bg-[var(--surface-2)] hover:text-[var(--fg)] focus-visible:outline-2 focus-visible:outline-[var(--accent)] focus-visible:outline-offset-2",
        "disabled:pointer-events-none disabled:opacity-40",
      )}
    >
      {children}
    </button>
  );
}
