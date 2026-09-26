import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { AttemptSummary, RequestTrace } from "@/components/timeline/request-trace";
import { Badge, Chip, StatusDot } from "@/components/ui/badge";
import { PageHeader, Panel, PanelHeader } from "@/components/ui/panel";
import { StatCell, StatGrid, MetaRow } from "@/components/ui/stat";
import {
  errorCategoryLabel,
  formatCost,
  formatDateTimeSeconds,
  formatDuration,
  formatNumber,
  relativeTime,
} from "@/lib/format";
import { getRequestTrace } from "@/lib/queries";
import { errorTone, requestTone, REQUEST_STATUS_LABEL } from "@/lib/status";

export const dynamic = "force-dynamic";

export default async function RequestDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const data = await getRequestTrace(id);
  if (!data) notFound();

  const { request, events, attempts } = data;
  const succeeded = request.status === "succeeded";

  return (
    <>
      <Link
        href="/"
        className="mb-3 inline-flex min-h-7 items-center gap-1.5 rounded-[var(--radius-control)] pr-2 text-[12.5px] font-[550] text-[var(--fg-muted)] transition-colors hover:text-[var(--fg)] focus-visible:outline-2 focus-visible:outline-[var(--accent)]"
      >
        <ArrowLeft size={13} strokeWidth={2} />
        Overview
      </Link>

      <PageHeader
        title={`Request ${request.correlationId}`}
        description={`${formatDateTimeSeconds(request.startedAt)} · ${relativeTime(request.startedAt)}`}
        actions={
          <Badge tone={requestTone(request.status)} dot>
            {REQUEST_STATUS_LABEL[request.status]}
          </Badge>
        }
      />

      <StatGrid columns={5} className="mb-4">
        <StatCell
          label="Total latency"
          value={formatDuration(request.totalLatencyMs)}
          detail="Webhook to delivery"
        />
        <StatCell
          label="Provider attempts"
          value={String(request.attemptCount)}
          detail={`${request.fallbackCount} fallback${request.fallbackCount === 1 ? "" : "s"}`}
          tone={request.fallbackCount > 0 ? "warning" : undefined}
        />
        <StatCell
          label="Answered by"
          value={request.providerName ?? "—"}
          detail={request.model ?? "No provider answered"}
          tone={succeeded ? undefined : "error"}
        />
        <StatCell
          label="Tokens"
          value={request.totalTokens === null ? "—" : formatNumber(request.totalTokens)}
          detail={
            request.promptTokens !== null
              ? `${formatNumber(request.promptTokens)} in · ${formatNumber(request.completionTokens)} out`
              : "Usage not reported"
          }
        />
        <StatCell
          label="Delivered"
          value={request.telegramDelivered === null ? "—" : request.telegramDelivered ? "Yes" : "No"}
          detail={formatCost(request.estimatedCost)}
          tone={request.telegramDelivered === false ? "error" : undefined}
        />
      </StatGrid>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="flex flex-col gap-4 lg:col-span-2">
          <Panel>
            <PanelHeader
              kicker="Timeline"
              title="Execution trace"
              description="Left column is wall-clock time, right column is the time each step took."
            />
            <div className="px-4 py-3.5">
              <RequestTrace events={events} />
            </div>
          </Panel>

          <Panel>
            <PanelHeader
              kicker="Prompt"
              title="What triggered this request"
              description="The inbound message that opened the turn."
            />
            <div className="p-4">
              <p className="rounded-[var(--radius-control)] border border-[var(--line)] bg-[var(--surface-inset)] px-3.5 py-3 font-[var(--font-mono)] text-[12.5px] leading-[20px] whitespace-pre-wrap break-words text-[var(--fg)]">
                {request.triggerText ?? "—"}
              </p>
            </div>
          </Panel>
        </div>

        <div className="flex flex-col gap-4">
          <Panel>
            <PanelHeader kicker="Chain" title="Provider attempts" />
            <div className="px-4 py-3">
              <AttemptSummary attempts={attempts} />
            </div>
          </Panel>

          <Panel>
            <PanelHeader kicker="Record" title="Details" />
            <dl className="px-4 py-2">
              <MetaRow label="Correlation id" mono>
                {request.correlationId}
              </MetaRow>
              <MetaRow label="Chat ID" mono>
                {request.chatId}
              </MetaRow>
              <MetaRow label="Provider" >
                {request.providerName ?? "—"}
              </MetaRow>
              <MetaRow label="Model" mono>
                {request.model ? <Chip>{request.model}</Chip> : "—"}
              </MetaRow>
              <MetaRow label="Started">{formatDateTimeSeconds(request.startedAt)}</MetaRow>
              <MetaRow label="Completed">
                {request.completedAt ? formatDateTimeSeconds(request.completedAt) : "—"}
              </MetaRow>
            </dl>
          </Panel>

          {request.errorMessage ? (
            <Panel>
              <PanelHeader kicker="Failure" title="What went wrong" />
              <div className="p-4">
                {request.errorCategory ? (
                  <Badge tone={errorTone(request.errorCategory)} className="mb-2">
                    {errorCategoryLabel(request.errorCategory)}
                  </Badge>
                ) : null}
                <p className="rounded-[var(--radius-control)] border border-[var(--line)] bg-[var(--surface-inset)] px-3 py-2 font-[var(--font-mono)] text-[11.5px] leading-[16px] break-words text-[var(--fg-muted)]">
                  {request.errorMessage}
                </p>
                {request.telegramError ? (
                  <p className="mt-2 text-[11.5px] leading-4 text-[var(--fg-subtle)]">
                    Telegram delivery also failed: {request.telegramError}
                  </p>
                ) : null}
              </div>
            </Panel>
          ) : null}

          {request.status === "running" ? (
            <Panel>
              <div className="flex items-center gap-2 px-4 py-3">
                <StatusDot tone="info" pulse />
                <p className="text-[12.5px] text-[var(--fg-muted)]">
                  This request is still running. Reload to see the final outcome.
                </p>
              </div>
            </Panel>
          ) : null}
        </div>
      </div>
    </>
  );
}
