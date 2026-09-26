import type { Metadata } from "next";
import Link from "next/link";
import { Bot, Info } from "lucide-react";

import { ProviderManager } from "@/components/providers/provider-manager";
import { PageHeader, Panel, PanelHeader } from "@/components/ui/panel";
import { EmptyState } from "@/components/ui/table";
import { listAdapters } from "@/lib/providers/registry";
import { listProviderRows, toSummary } from "@/lib/providers/service";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "AI Providers" };

export default async function ProvidersPage() {
  const rows = await listProviderRows(true);
  const providers = rows.map(toSummary);
  const adapters = listAdapters();
  const enabled = providers.filter((p) => p.enabled);

  return (
    <>
      <PageHeader
        title="AI providers"
        description="Every provider the gateway can call. The chain runs top to bottom: the first enabled provider answers, and the rest are fallbacks."
        actions={
          <span className="tnum font-[var(--font-mono)] text-[12px] text-[var(--fg-subtle)]">
            {enabled.length} of {providers.length} enabled
          </span>
        }
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Panel>
            <PanelHeader
              kicker="Fallback chain"
              title="Order matters"
              description="Move a provider up to try it earlier. The numbered badge shows its live position in the chain."
            />
            {providers.length === 0 ? (
              <EmptyState
                icon={<Bot size={15} strokeWidth={1.7} />}
                title="No providers configured"
                description="The gateway needs at least one enabled provider to answer a message. Add one below — no redeploy or .env change required."
              />
            ) : null}
            <ProviderManager initialProviders={providers} adapters={adapters} />
          </Panel>
        </div>

        <div className="flex flex-col gap-4">
          <Panel>
            <PanelHeader kicker="How it works" title="Fallback rules" />
            <ul className="flex flex-col gap-2.5 p-4">
              {[
                ["Retried in place", "Timeouts, network failures, 429 and 5xx are retried on the same provider."],
                ["Moves to the next provider", "Anything transient, plus 401 and 403 from an expired key."],
                ["Stops immediately", "A 4xx the provider actually rejected. The rest of the chain is not burned."],
              ].map(([title, body]) => (
                <li key={title} className="flex gap-2.5">
                  <span
                    aria-hidden
                    className="mt-[7px] size-1.5 shrink-0 rounded-full bg-[var(--accent)]"
                  />
                  <span>
                    <span className="block text-[12.5px] font-[550] text-[var(--fg)]">{title}</span>
                    <span className="mt-0.5 block text-[12px] leading-[16px] text-[var(--fg-muted)]">
                      {body}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          </Panel>

          <Panel>
            <PanelHeader kicker="Reference" title="API formats" />
            <ul className="divide-y divide-[var(--line-faint)]">
              {adapters.map((adapter) => (
                <li key={adapter.id} className="px-4 py-2.5">
                  <p className="text-[12.5px] font-[550] text-[var(--fg)]">{adapter.label}</p>
                  <p className="mt-0.5 text-[12px] leading-[16px] text-[var(--fg-muted)]">
                    {adapter.hint}
                  </p>
                </li>
              ))}
            </ul>
          </Panel>

          <Panel>
            <div className="flex gap-2.5 p-4">
              <Info size={14} strokeWidth={2} className="mt-px shrink-0 text-[var(--fg-subtle)]" />
              <p className="text-[12px] leading-[17px] text-[var(--fg-muted)]">
                API keys are encrypted with <code className="font-[var(--font-mono)]">ENCRYPTION_KEY</code>{" "}
                before they are stored and are never sent back to the browser. Deleting a provider
                keeps its name on messages it already produced — see{" "}
                <Link href="/messages" className="text-[var(--accent)] underline underline-offset-2">
                  Messages
                </Link>
                .
              </p>
            </div>
          </Panel>
        </div>
      </div>
    </>
  );
}
