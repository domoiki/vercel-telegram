import Link from "next/link";
import {
  ArrowUpRight,
  Bot,
  Inbox,
  MessageSquare,
  MessagesSquare,
} from "lucide-react";

import { ActivityChart, LatencyBar } from "@/components/charts/activity-chart";
import { Badge, StatusDot } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/table";
import { PageHeader, Panel, PanelHeader, PanelLink } from "@/components/ui/panel";
import { StatCell, StatGrid } from "@/components/ui/stat";
import {
  formatCompact,
  formatCost,
  formatDuration,
  formatNumber,
  formatPercent,
  formatTime,
  relativeTime,
  truncate,
} from "@/lib/format";
import { getSystemHealth } from "@/lib/health";
import {
  getMessageActivity,
  getOverviewStats,
  getProviderLatency,
  getRecentErrors,
  getRecentRequests,
} from "@/lib/queries";
import { healthTone, logTone, requestTone } from "@/lib/status";

export const dynamic = "force-dynamic";

export default async function OverviewPage() {
  const [stats, activity, latency, recent, errors, health] = await Promise.all([
    getOverviewStats(),
    getMessageActivity(14),
    getProviderLatency(7),
    getRecentRequests(8),
    getRecentErrors(5),
    getSystemHealth(),
  ]);

  const maxLatency = Math.max(1, ...latency.map((l) => l.p95LatencyMs));

  return (
    <>
      <PageHeader
        title="Overview"
        description="What the gateway did in the last 30 days, and what it is doing right now."
        actions={
          <>
            <Link
              href="/messages"
              className="inline-flex h-8.5 items-center gap-1.5 rounded-[var(--radius-control)] border border-[var(--line-strong)] px-3 text-[13px] font-[550] text-[var(--fg)] transition-colors hover:bg-[var(--surface-2)] focus-visible:outline-2 focus-visible:outline-[var(--accent)] focus-visible:outline-offset-2"
            >
              <MessageSquare size={14} strokeWidth={1.9} />
              Messages
            </Link>
            <Link
              href="/providers"
              className="inline-flex h-8.5 items-center gap-1.5 rounded-[var(--radius-control)] bg-[var(--accent)] px-3 text-[13px] font-[550] text-[var(--accent-fg)] transition-colors hover:bg-[var(--accent-hover)] focus-visible:outline-2 focus-visible:outline-[var(--accent)] focus-visible:outline-offset-2"
            >
              <Bot size={14} strokeWidth={2} />
              Configure providers
            </Link>
          </>
        }
      />

      <StatGrid columns={4} className="mb-4">
        <StatCell
          label="Messages handled"
          value={formatCompact(stats.totalMessages)}
          detail={`${formatNumber(stats.successfulMessages)} delivered · ${formatNumber(stats.failedMessages)} failed`}
        />
        <StatCell
          label="AI requests"
          value={formatCompact(stats.totalRequests)}
          detail={`${formatPercent(stats.successRate)} succeeded`}
          tone={stats.totalRequests > 0 && stats.successRate < 90 ? "warning" : undefined}
        />
        <StatCell
          label="Average response"
          value={stats.avgLatencyMs === null ? "—" : formatDuration(stats.avgLatencyMs).replace(/s$/, "")}
          unit={stats.avgLatencyMs !== null && stats.avgLatencyMs >= 1000 ? "s" : undefined}
          detail="End to end, provider to Telegram"
        />
        <StatCell
          label="Fallback rate"
          value={formatPercent(stats.fallbackRate, 1)}
          detail={`${formatNumber(stats.fallbackRequests)} request${stats.fallbackRequests === 1 ? "" : "s"} used a backup provider`}
          tone={stats.fallbackRate > 25 ? "warning" : undefined}
        />
      </StatGrid>

      {/*
        `min-w-0` on the grid children is load-bearing: without it a grid item's
        automatic minimum size is its min-content width, so a long message
        preview would widen the whole page instead of truncating.
      */}
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="flex min-w-0 flex-col gap-4 lg:col-span-2">
          <Panel>
            <PanelHeader
              kicker="Last 14 days"
              title="Message activity"
              description="What arrived from Telegram against what the gateway sent back."
              action={
                <div className="hidden items-center gap-4 sm:flex">
                  <span className="text-right">
                    <span className="block font-[var(--font-mono)] text-[10.5px] leading-3.5 text-[var(--fg-subtle)]">
                      tokens
                    </span>
                    <span className="tnum block text-[13px] leading-4 font-[600] text-[var(--fg)]">
                      {stats.totalTokens === null ? "—" : formatCompact(stats.totalTokens)}
                    </span>
                  </span>
                  <span className="text-right">
                    <span className="block font-[var(--font-mono)] text-[10.5px] leading-3.5 text-[var(--fg-subtle)]">
                      est. cost
                    </span>
                    <span className="tnum block text-[13px] leading-4 font-[600] text-[var(--fg)]">
                      {formatCost(stats.totalCost)}
                    </span>
                  </span>
                </div>
              }
            />
            <div className="p-4">
              <ActivityChart data={activity} />
            </div>
          </Panel>

          <Panel>
            <PanelHeader
              kicker="Live"
              title="Recent requests"
              description="Newest first. Open one to see its full execution trace."
              action={<PanelLink href="/logs">All activity</PanelLink>}
            />
            {recent.length === 0 ? (
              <EmptyState
                icon={<Inbox size={15} strokeWidth={1.7} />}
                title="No requests yet"
                description={
                  <>
                    Requests appear here as soon as an allowlisted chat sends a message. Check that
                    the webhook is registered in{" "}
                    <Link
                      href="/settings"
                      className="text-[var(--accent)] underline underline-offset-2"
                    >
                      Settings → Telegram
                    </Link>
                    .
                  </>
                }
              />
            ) : (
              <ul>
                {recent.map((request) => (
                  <li key={request.id}>
                    <Link
                      href={`/requests/${request.id}`}
                      className="flex items-center gap-3 border-b border-[var(--line-faint)] px-4 py-2.5 transition-colors last:border-0 hover:bg-[var(--surface-2)] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--accent)]"
                    >
                      <StatusDot
                        tone={requestTone(request.status)}
                        pulse={request.status === "running"}
                      />
                      <span className="tnum w-[58px] shrink-0 font-[var(--font-mono)] text-[11.5px] text-[var(--fg)]">
                        {request.correlationId}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-[12.5px] text-[var(--fg-muted)]">
                        {truncate(request.triggerText ?? "—", 90)}
                      </span>
                      <span className="hidden shrink-0 text-[12px] text-[var(--fg)] sm:block">
                        {request.providerName ?? "—"}
                      </span>
                      {request.fallbackCount > 0 ? (
                        <Badge tone="warning">fallback ×{request.fallbackCount}</Badge>
                      ) : null}
                      <span className="tnum hidden w-16 shrink-0 text-right font-[var(--font-mono)] text-[11.5px] text-[var(--fg-subtle)] sm:block">
                        {formatDuration(request.totalLatencyMs)}
                      </span>
                      <span className="hidden w-16 shrink-0 text-right font-[var(--font-mono)] text-[11.5px] text-[var(--fg-subtle)] lg:block">
                        {relativeTime(request.startedAt)}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>

        <div className="flex min-w-0 flex-col gap-4">
          <Panel>
            <PanelHeader kicker="Status" title="Gateway" />
            <div className="divide-y divide-[var(--line-faint)]">
              <StatusRow
                label="Database"
                detail={health.database.detail}
                state={health.database.state}
              />
              <StatusRow
                label="Telegram"
                detail={health.telegram.detail}
                state={health.telegram.state}
                href="/settings"
              />
              <StatusRow
                label="Primary provider"
                detail={health.providers.primary ?? health.providers.detail}
                state={health.providers.state}
                href="/providers"
              />
              <div className="flex items-baseline justify-between gap-3 px-4 py-2.5">
                <span className="text-[12px] text-[var(--fg-muted)]">Active chats</span>
                <span className="tnum text-[12.5px] font-[500]">
                  {formatNumber(stats.activeConversations)}
                </span>
              </div>
            </div>
          </Panel>

          <Panel>
            <PanelHeader
              kicker="7 days"
              title="Provider latency"
              description="End-to-end time per successful request."
            />
            {latency.length === 0 ? (
              <EmptyState
                icon={<Bot size={15} strokeWidth={1.7} />}
                title="No provider traffic"
                description="Latency appears once providers have completed requests."
              />
            ) : (
              <ul className="divide-y divide-[var(--line-faint)]">
                {latency.map((row) => (
                  <li key={row.providerId} className="px-4 py-2.5">
                    <div className="mb-1.5 flex items-baseline justify-between gap-3">
                      <span className="truncate text-[12.5px] font-[550] text-[var(--fg)]">
                        {row.providerName}
                      </span>
                      <span className="tnum shrink-0 font-[var(--font-mono)] text-[11.5px] text-[var(--fg-muted)]">
                        {formatDuration(row.avgLatencyMs)}
                        <span className="text-[var(--fg-subtle)]"> avg</span>
                      </span>
                    </div>
                    <LatencyBar value={row.p95LatencyMs} max={maxLatency} />
                    <div className="mt-1.5 flex items-center justify-between gap-2">
                      <span className="tnum font-[var(--font-mono)] text-[10.5px] text-[var(--fg-subtle)]">
                        p95 {formatDuration(row.p95LatencyMs)}
                      </span>
                      <span className="tnum font-[var(--font-mono)] text-[10.5px] text-[var(--fg-subtle)]">
                        {formatNumber(row.requests)} req
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel>
            <PanelHeader
              kicker="Attention"
              title="Recent warnings"
              action={<PanelLink href="/logs">All logs</PanelLink>}
            />
            {errors.length === 0 ? (
              <EmptyState
                icon={<MessagesSquare size={15} strokeWidth={1.7} />}
                title="Nothing to review"
                description="Errors and warnings from the gateway, providers and Telegram will collect here."
              />
            ) : (
              <ul className="divide-y divide-[var(--line-faint)]">
                {errors.map((entry) => (
                  <li key={entry.id} className="px-4 py-2.5">
                    <div className="flex items-center gap-2">
                      <StatusDot tone={logTone(entry.level)} />
                      <span className="truncate font-[var(--font-mono)] text-[11.5px] text-[var(--fg)]">
                        {entry.event}
                      </span>
                      <span className="ml-auto shrink-0 font-[var(--font-mono)] text-[10.5px] text-[var(--fg-subtle)]">
                        {formatTime(entry.createdAt)}
                      </span>
                    </div>
                    {entry.message ? (
                      <p className="mt-1 pl-3.5 text-[12px] leading-[16px] text-[var(--fg-muted)]">
                        {truncate(entry.message, 150)}
                      </p>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
      </div>
    </>
  );
}

function StatusRow({
  label,
  detail,
  state,
  href,
}: {
  label: string;
  detail: string;
  state: "ok" | "warn" | "error" | "unknown";
  href?: string;
}) {
  const body = (
    <>
      <span className="flex items-center gap-2">
        <StatusDot tone={healthTone(state)} pulse={state === "ok"} />
        <span className="text-[12.5px] font-[500] text-[var(--fg)]">{label}</span>
      </span>
      <span className="flex min-w-0 items-center gap-2">
        <span className="truncate text-[12px] text-[var(--fg-muted)]">{detail}</span>
        {href ? (
          <ArrowUpRight size={11} className="shrink-0 text-[var(--fg-subtle)]" strokeWidth={2} />
        ) : null}
      </span>
    </>
  );

  const className =
    "flex items-center justify-between gap-3 px-4 py-2.5 transition-colors hover:bg-[var(--surface-2)]";

  return href ? (
    <Link href={href} className={className}>
      {body}
    </Link>
  ) : (
    <div className={className}>{body}</div>
  );
}
