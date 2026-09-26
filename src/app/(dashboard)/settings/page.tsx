import type { Metadata } from "next";
import Link from "next/link";
import { Activity, Bot, Database, Server, ShieldCheck } from "lucide-react";

import { AppearanceSettings } from "@/components/settings/appearance-settings";
import { ConversationSettings } from "@/components/settings/conversation-settings";
import { TelegramSettings, type TelegramConfigView } from "@/components/settings/telegram-settings";
import { Badge, Chip, StatusDot } from "@/components/ui/badge";
import { PageHeader, Panel, PanelHeader, PanelLink } from "@/components/ui/panel";
import { MetaRow } from "@/components/ui/stat";
import { maskSecret, decryptSecret } from "@/lib/crypto";
import { formatDateTime, relativeTime } from "@/lib/format";
import { getSystemHealth } from "@/lib/health";
import { listProviderRows } from "@/lib/providers/service";
import { getSettings, getTelegramConfig } from "@/lib/settings";
import { healthTone } from "@/lib/status";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage() {
  const [settings, telegram, health, providers] = await Promise.all([
    getSettings(),
    getTelegramConfig(),
    getSystemHealth(),
    listProviderRows(true),
  ]);

  const config: TelegramConfigView = {
    hasBotToken: Boolean(telegram.botTokenEncrypted),
    botTokenMask: maskSecret(decryptSecret(telegram.botTokenEncrypted)),
    chatId1: telegram.chatId1 ?? "",
    chatId2: telegram.chatId2 ?? "",
    chatId3: telegram.chatId3 ?? "",
    replyToUnauthorized: telegram.replyToUnauthorized,
    botUsername: telegram.botUsername,
    botDisplayName: telegram.botDisplayName,
    webhookUrl: telegram.webhookUrl,
    webhookPendingCount: telegram.webhookPendingCount,
    webhookLastError: telegram.webhookLastError,
    lastCheckedAt: telegram.lastCheckedAt,
    updatedAt: telegram.updatedAt,
  };

  const enabledProviders = providers.filter((p) => p.enabled);
  const primary = providers.find((p) => p.isPrimary && p.enabled);
  const adminKeySet = Boolean(process.env.ADMIN_API_KEY);

  return (
    <>
      <PageHeader
        title="Settings"
        description="Everything the gateway needs is configured here. Adding a provider, changing a chat id or moving the fallback order never needs a redeploy or a .env edit."
      />

      <div className="flex flex-col gap-4">
        <Panel>
          <PanelHeader
            kicker="Conversation engine"
            title="Defaults"
            description="Applied to every request unless a provider overrides them."
            action={<PanelLink href="/providers">Manage providers</PanelLink>}
          />
          <ConversationSettings settings={settings} />
        </Panel>

        <Panel>
          <PanelHeader
            kicker="Routing"
            title="Provider chain"
            description="The order the router tries, in the order it will try them."
            action={<PanelLink href="/providers">Reorder chain</PanelLink>}
          />
          {providers.length === 0 ? (
            <p className="px-4 py-5 text-[12.5px] text-[var(--fg-muted)]">
              No providers yet.{" "}
              <Link href="/providers" className="text-[var(--accent)] underline underline-offset-2">
                Add your first provider
              </Link>{" "}
              to start answering messages.
            </p>
          ) : (
            <ol className="divide-y divide-[var(--line-faint)]">
              {[primary, ...enabledProviders.filter((p) => p.id !== primary?.id)].map(
                (provider, index) =>
                  provider ? (
                    <li key={provider.id} className="flex flex-wrap items-center gap-2.5 px-4 py-2.5">
                      <span
                        aria-hidden
                        className="tnum flex size-5 shrink-0 items-center justify-center rounded-[4px] border border-[var(--accent-line)] bg-[var(--accent-wash)] font-[var(--font-mono)] text-[10.5px] text-[var(--accent)]"
                      >
                        {index + 1}
                      </span>
                      <span className="text-[12.5px] font-[550] text-[var(--fg)]">
                        {provider.name}
                      </span>
                      {index === 0 ? <Badge tone="accent">Primary</Badge> : <Badge tone="neutral">Fallback</Badge>}
                      <Chip>{provider.model}</Chip>
                      <span className="ml-auto flex items-center gap-1.5 text-[11.5px] text-[var(--fg-subtle)]">
                        <StatusDot
                          tone={
                            !provider.lastTestedAt
                              ? "neutral"
                              : provider.lastTestOk
                                ? "success"
                                : "error"
                          }
                        />
                        {!provider.lastTestedAt
                          ? "Never tested"
                          : provider.lastTestOk
                            ? `Passed ${relativeTime(provider.lastTestedAt)}`
                            : `Failed ${relativeTime(provider.lastTestedAt)}`}
                      </span>
                    </li>
                  ) : null,
              )}
            </ol>
          )}
        </Panel>

        <Panel>
          <PanelHeader
            kicker="Telegram"
            title="Bot and allowlist"
            description="One bot token and exactly three chat slots. The token is encrypted at rest."
          />
          <TelegramSettings initial={config} />
        </Panel>

        <Panel>
          <PanelHeader
            kicker="Appearance"
            title="Theme"
            description="Both themes are designed independently. The choice is saved server-side and applied on your next visit."
          />
          <AppearanceSettings initial={settings.defaultTheme} />
        </Panel>

        <Panel>
          <PanelHeader kicker="System" title="Health and version" />
          <div className="grid gap-4 p-4 sm:grid-cols-2 lg:grid-cols-3">
            <HealthCard
              icon={<Database size={14} strokeWidth={1.9} />}
              title="Database"
              state={health.database.state}
              rows={[
                ["Driver", process.env.TURSO_DATABASE_URL ? "Turso (libSQL)" : "Local SQLite"],
                ["Query time", health.database.latencyMs === null ? "—" : `${health.database.latencyMs}ms`],
              ]}
            />
            <HealthCard
              icon={<Bot size={14} strokeWidth={1.9} />}
              title="Telegram"
              state={health.telegram.state}
              rows={[
                ["Bot", config.botUsername ? `@${config.botUsername}` : "Not verified"],
                [
                  "Allowlist",
                  `${health.telegram.chatSlotsConfigured}/3 chat slots`,
                ],
                ["Webhook", config.webhookUrl ? "Registered" : "Not registered"],
              ]}
            />
            <HealthCard
              icon={<Activity size={14} strokeWidth={1.9} />}
              title="Providers"
              state={health.providers.state}
              rows={[
                ["Enabled", `${health.providers.enabled} of ${health.providers.total}`],
                ["Primary", health.providers.primary ?? "None"],
                ["Retries", `${settings.retryAttempts} per provider`],
              ]}
            />
            <HealthCard
              icon={<Server size={14} strokeWidth={1.9} />}
              title="Application"
              state="ok"
              rows={[
                ["Version", health.appVersion],
                ["Runtime", "Vercel serverless (Node)"],
                ["Webhook route", "/api/telegram/webhook"],
              ]}
            />
            <div className="rounded-[var(--radius-control)] border border-[var(--line)] p-3.5 sm:col-span-2">
              <div className="mb-2 flex items-center gap-2">
                <ShieldCheck size={14} strokeWidth={1.9} className="text-[var(--fg-muted)]" />
                <p className="text-[12.5px] font-[600] text-[var(--fg)]">Credential handling</p>
              </div>
              <ul className="flex flex-col gap-1.5">
                {[
                  `Bot token: ${config.hasBotToken ? `stored, shown as ${config.botTokenMask}` : "not set"}`,
                  "Provider API keys: encrypted with AES-256-GCM, never returned to the browser",
                  "Encryption key: read from ENCRYPTION_KEY, never stored in the database",
                  `Admin write protection: ${adminKeySet ? "enabled (ADMIN_API_KEY is set)" : "off — acceptable on a private deployment"}`,
                ].map((line) => (
                  <li key={line} className="flex gap-2 text-[12px] leading-[16px] text-[var(--fg-muted)]">
                    <span
                      aria-hidden
                      className="mt-[7px] size-1 shrink-0 rounded-full bg-[var(--fg-subtle)]"
                    />
                    {line}
                  </li>
                ))}
              </ul>
            </div>
          </div>

          <dl className="border-t border-[var(--line)] px-4 py-2">
            <MetaRow label="Telegram config last updated" mono>
              {formatDateTime(telegram.updatedAt)}
            </MetaRow>
            <MetaRow label="Telegram last checked" mono>
              {telegram.lastCheckedAt ? formatDateTime(telegram.lastCheckedAt) : "Never"}
            </MetaRow>
          </dl>
        </Panel>
      </div>
    </>
  );
}

function HealthCard({
  icon,
  title,
  state,
  rows,
}: {
  icon: React.ReactNode;
  title: string;
  state: "ok" | "warn" | "error" | "unknown";
  rows: Array<[string, string]>;
}) {
  return (
    <div className="rounded-[var(--radius-control)] border border-[var(--line)] p-3.5">
      <div className="mb-2 flex items-center gap-2">
        <span className="text-[var(--fg-muted)]">{icon}</span>
        <p className="text-[12.5px] font-[600] text-[var(--fg)]">{title}</p>
        <Badge tone={healthTone(state)} dot className="ml-auto">
          {state === "ok" ? "Healthy" : state === "warn" ? "Attention" : state === "error" ? "Problem" : "Unknown"}
        </Badge>
      </div>
      <dl className="flex flex-col">
        {rows.map(([label, value]) => (
          <div
            key={label}
            className="flex items-baseline justify-between gap-3 border-b border-[var(--line-faint)] py-1 last:border-0"
          >
            <dt className="text-[11.5px] text-[var(--fg-muted)]">{label}</dt>
            <dd className="truncate font-[var(--font-mono)] text-[11px] text-[var(--fg)]">{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
