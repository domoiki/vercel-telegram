import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, CornerDownRight, Route } from "lucide-react";

import { Badge, Chip } from "@/components/ui/badge";
import { PageHeader, Panel, PanelHeader } from "@/components/ui/panel";
import { StatCell, StatGrid } from "@/components/ui/stat";
import {
  displayName,
  formatDateTime,
  formatDuration,
  formatFullDate,
  formatNumber,
  initials,
  relativeTime,
  truncate,
} from "@/lib/format";
import { getConversationDetail } from "@/lib/queries";
import { messageTone, STATUS_LABEL } from "@/lib/status";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function ConversationDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const data = await getConversationDetail(id);
  if (!data) notFound();

  const { conversation, messages } = data;
  const outbound = messages.filter((m) => m.direction === "outbound");
  const inbound = messages.filter((m) => m.direction === "inbound");
  const delivered = outbound.filter((m) => m.status === "delivered").length;
  const latencies = outbound
    .map((m) => m.latencyMs)
    .filter((v): v is number => typeof v === "number");
  const avgLatency =
    latencies.length > 0
      ? Math.round(latencies.reduce((sum, v) => sum + v, 0) / latencies.length)
      : null;

  return (
    <>
      <Link
        href="/conversations"
        className="mb-3 inline-flex min-h-7 items-center gap-1.5 rounded-[var(--radius-control)] pr-2 text-[12.5px] font-[550] text-[var(--fg-muted)] transition-colors hover:text-[var(--fg)] focus-visible:outline-2 focus-visible:outline-[var(--accent)]"
      >
        <ArrowLeft size={13} strokeWidth={2} />
        All conversations
      </Link>

      <PageHeader
        title={displayName(conversation)}
        description={`Chat ${conversation.chatId}${conversation.username ? ` · @${conversation.username}` : ""} · started ${formatFullDate(conversation.createdAt)}`}
        actions={
          <div className="flex items-center gap-2.5">
            <span
              aria-hidden
              className="flex size-8 items-center justify-center rounded-[6px] border border-[var(--line)] bg-[var(--surface-2)] font-[var(--font-mono)] text-[11.5px] text-[var(--fg-muted)]"
            >
              {initials(conversation)}
            </span>
            <span className="font-[var(--font-mono)] text-[12px] text-[var(--fg-muted)]">
              {conversation.chatId}
            </span>
          </div>
        }
      />

      <StatGrid columns={4} className="mb-4">
        <StatCell label="Messages" value={formatNumber(messages.length)} detail={`${inbound.length} in · ${outbound.length} out`} />
        <StatCell
          label="Delivered"
          value={`${outbound.length === 0 ? 0 : Math.round((delivered / outbound.length) * 100)}%`}
          detail={`${delivered} of ${outbound.length} replies`}
          tone={delivered < outbound.length ? "warning" : undefined}
        />
        <StatCell
          label="Average reply"
          value={avgLatency === null ? "—" : formatDuration(avgLatency)}
          detail="Provider response time"
        />
        <StatCell
          label="Last activity"
          value={relativeTime(conversation.lastMessageAt)}
          detail={formatDateTime(conversation.lastMessageAt)}
        />
      </StatGrid>

      <Panel>
        <PanelHeader
          kicker="Transcript"
          title="Messages in order"
          description="Replies link to the request that produced them."
        />
        {messages.length === 0 ? (
          <p className="px-4 py-10 text-center text-[12.5px] text-[var(--fg-muted)]">
            This thread has no messages.
          </p>
        ) : (
          <ol className="divide-y divide-[var(--line-faint)]">
            {messages.map((message) => {
              const isInbound = message.direction === "inbound";
              return (
                <li
                  key={message.id}
                  className={cn(
                    "grid gap-x-4 gap-y-2 px-4 py-3.5 md:grid-cols-[92px_1fr]",
                    isInbound ? "bg-transparent" : "bg-[var(--surface-2)]/60",
                  )}
                >
                  <div className="flex items-baseline gap-1.5 md:flex-col md:items-end md:gap-0.5">
                    <span className="tnum font-[var(--font-mono)] text-[11px] text-[var(--fg-subtle)]">
                      {formatDateTime(message.createdAt)}
                    </span>
                    <span
                      className={cn(
                        "font-[var(--font-mono)] text-[10.5px] tracking-[0.05em] uppercase",
                        isInbound ? "text-[var(--info)]" : "text-[var(--accent)]",
                      )}
                    >
                      {isInbound ? "in" : "out"}
                    </span>
                  </div>

                  <div className="min-w-0">
                    <p className="text-[13px] leading-[20px] whitespace-pre-wrap break-words text-[var(--fg)]">
                      {message.text}
                    </p>

                    <div className="mt-2 flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
                      <Badge tone={messageTone(message.status)} dot>
                        {STATUS_LABEL[message.status]}
                      </Badge>
                      {message.providerName ? (
                        <span className="inline-flex items-center gap-1 text-[11.5px] text-[var(--fg-muted)]">
                          <CornerDownRight size={10} strokeWidth={2} className="text-[var(--fg-subtle)]" />
                          {message.providerName}
                        </span>
                      ) : null}
                      {message.model ? <Chip>{message.model}</Chip> : null}
                      {message.latencyMs ? (
                        <span className="tnum font-[var(--font-mono)] text-[11px] text-[var(--fg-subtle)]">
                          {formatDuration(message.latencyMs)}
                        </span>
                      ) : null}
                      {message.requestId ? (
                        <Link
                          href={`/requests/${message.requestId}`}
                          className="inline-flex min-h-7 items-center gap-1 rounded-[var(--radius-control)] border border-[var(--line)] px-2 text-[11.5px] font-[550] text-[var(--fg-muted)] transition-colors hover:bg-[var(--surface-3)] hover:text-[var(--fg)] focus-visible:outline-2 focus-visible:outline-[var(--accent)]"
                        >
                          <Route size={10} strokeWidth={2.2} />
                          Trace
                        </Link>
                      ) : null}
                      <Link
                        href={`/messages/${message.id}`}
                        className="inline-flex min-h-7 items-center rounded-[var(--radius-control)] px-2 text-[11.5px] text-[var(--fg-subtle)] transition-colors hover:text-[var(--fg)] focus-visible:outline-2 focus-visible:outline-[var(--accent)]"
                      >
                        Details
                      </Link>
                    </div>

                    {message.errorMessage ? (
                      <p className="mt-2 rounded-[var(--radius-control)] border border-[var(--line)] bg-[var(--error-wash)] px-2.5 py-1.5 font-[var(--font-mono)] text-[11px] leading-[15px] text-[var(--error)]">
                        {truncate(message.errorMessage, 300)}
                      </p>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </Panel>
    </>
  );
}
