import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ExternalLink } from "lucide-react";

import { RequestTrace } from "@/components/timeline/request-trace";
import { Badge, Chip } from "@/components/ui/badge";
import { PageHeader, Panel, PanelHeader } from "@/components/ui/panel";
import { MetaRow } from "@/components/ui/stat";
import {
  errorCategoryLabel,
  formatDateTimeSeconds,
  formatDuration,
  formatFullDate,
  relativeTime,
} from "@/lib/format";
import { getMessageById, getRequestTrace } from "@/lib/queries";
import { errorTone, messageTone, requestTone, STATUS_LABEL } from "@/lib/status";

export const dynamic = "force-dynamic";

export default async function MessageDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const message = await getMessageById(id);
  if (!message) notFound();

  const traceData = message.requestId ? await getRequestTrace(message.requestId) : null;

  return (
    <>
      <Link
        href="/messages"
        className="mb-3 inline-flex min-h-7 items-center gap-1.5 rounded-[var(--radius-control)] pr-2 text-[12.5px] font-[550] text-[var(--fg-muted)] transition-colors hover:text-[var(--fg)] focus-visible:outline-2 focus-visible:outline-[var(--accent)]"
      >
        <ArrowLeft size={13} strokeWidth={2} />
        All messages
      </Link>

      <PageHeader
        title={message.direction === "inbound" ? "Inbound message" : "Outbound reply"}
        description={formatFullDate(message.createdAt)}
        actions={
          <Badge tone={messageTone(message.status)} dot>
            {STATUS_LABEL[message.status]}
          </Badge>
        }
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="flex flex-col gap-4 lg:col-span-2">
          <Panel>
            <PanelHeader
              kicker={message.direction === "inbound" ? "From Telegram" : "To Telegram"}
              title="Message body"
            />
            <div className="p-4">
              <div className="max-h-[52vh] overflow-y-auto rounded-[var(--radius-control)] border border-[var(--line)] bg-[var(--surface-inset)] px-3.5 py-3">
                <p className="font-[var(--font-mono)] text-[12.5px] leading-[20px] whitespace-pre-wrap break-words text-[var(--fg)]">
                  {message.text}
                </p>
              </div>
            </div>
          </Panel>

          {traceData ? (
            <Panel>
              <PanelHeader
                kicker={`Request ${traceData.request.correlationId}`}
                title="Execution trace"
                description="Every step the gateway took, in order."
                action={
                  <Link
                    href={`/requests/${traceData.request.id}`}
                    className="inline-flex min-h-7 items-center gap-1 rounded-[var(--radius-control)] border border-[var(--line-strong)] px-2.5 text-[12px] font-[550] text-[var(--fg)] transition-colors hover:bg-[var(--surface-2)] focus-visible:outline-2 focus-visible:outline-[var(--accent)]"
                  >
                    Full request
                    <ExternalLink size={11} strokeWidth={2} />
                  </Link>
                }
              />
              <div className="px-4 py-3">
                <RequestTrace events={traceData.events} />
              </div>
            </Panel>
          ) : null}
        </div>

        <div className="flex flex-col gap-4">
          <Panel>
            <PanelHeader kicker="Context" title="Delivery" />
            <dl className="px-4 py-2">
              <MetaRow label="Direction">
                {message.direction === "inbound" ? "Inbound" : "Outbound"}
              </MetaRow>
              <MetaRow label="Status">
                <Badge tone={messageTone(message.status)} dot>
                  {STATUS_LABEL[message.status]}
                </Badge>
              </MetaRow>
              <MetaRow label="Chat ID" mono>
                {message.chatId}
              </MetaRow>
              <MetaRow label="Telegram user" mono>
                {message.telegramUserId ?? "—"}
              </MetaRow>
              <MetaRow label="Telegram message id" mono>
                {message.telegramMessageId ?? "—"}
              </MetaRow>
              <MetaRow label="Received">{relativeTime(message.createdAt)}</MetaRow>
            </dl>
          </Panel>

          {message.providerName || message.errorMessage ? (
            <Panel>
              <PanelHeader kicker="Provider" title="Generation" />
              <dl className="px-4 py-2">
                <MetaRow label="Provider">{message.providerName ?? "—"}</MetaRow>
                <MetaRow label="Model" mono>
                  {message.model ? <Chip>{message.model}</Chip> : "—"}
                </MetaRow>
                <MetaRow label="Model latency" mono>
                  {formatDuration(message.latencyMs)}
                </MetaRow>
                {message.errorCategory ? (
                  <MetaRow label="Error">
                    <Badge tone={errorTone(message.errorCategory)}>
                      {errorCategoryLabel(message.errorCategory)}
                    </Badge>
                  </MetaRow>
                ) : null}
              </dl>
              {message.errorMessage ? (
                <p className="mx-4 mb-3 rounded-[var(--radius-control)] border border-[var(--line)] bg-[var(--surface-inset)] px-3 py-2 font-[var(--font-mono)] text-[11.5px] leading-[16px] text-[var(--fg-muted)]">
                  {message.errorMessage}
                </p>
              ) : null}
            </Panel>
          ) : null}

          {traceData ? (
            <Panel>
              <PanelHeader kicker="Request" title="Summary" />
              <dl className="px-4 py-2">
                <MetaRow label="Correlation id" mono>
                  {traceData.request.correlationId}
                </MetaRow>
                <MetaRow label="Status">
                  <Badge tone={requestTone(traceData.request.status)} dot>
                    {traceData.request.status}
                  </Badge>
                </MetaRow>
                <MetaRow label="Attempts" mono>
                  {traceData.request.attemptCount}
                </MetaRow>
                <MetaRow label="Started">{formatDateTimeSeconds(traceData.request.startedAt)}</MetaRow>
              </dl>
            </Panel>
          ) : null}
        </div>
      </div>
    </>
  );
}
