import Link from "next/link";
import type { Metadata } from "next";
import { MessageSquare, SearchX } from "lucide-react";

import { DateRangeFilter, FilterBar, FilterSelect, Pagination } from "@/components/filters/filter-bar";
import { Badge, StatusDot } from "@/components/ui/badge";
import { PageHeader, Panel } from "@/components/ui/panel";
import { EmptyState, TableWrap, Td, Th, Tr } from "@/components/ui/table";
import type { MessageStatus } from "@/lib/db/schema";
import { formatDateTime, formatDuration, relativeTime, truncate } from "@/lib/format";
import { getMessages } from "@/lib/queries";
import { listProviderRows } from "@/lib/providers/service";
import { DIRECTION_LABEL, messageTone, STATUS_LABEL } from "@/lib/status";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Messages" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function single(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

export default async function MessagesPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const params = await searchParams;
  const filters = {
    search: single(params.q),
    status: (single(params.status) as MessageStatus | "all" | undefined) ?? "all",
    direction: (single(params.direction) as "inbound" | "outbound" | "all" | undefined) ?? "all",
    providerId: single(params.provider),
    from: single(params.from),
    to: single(params.to),
    page: Number(single(params.page) ?? 1) || 1,
    perPage: 25,
  };

  const [{ rows, total, page, perPage }, providers] = await Promise.all([
    getMessages(filters),
    listProviderRows(true),
  ]);

  const hasFilters =
    Boolean(filters.search) ||
    filters.status !== "all" ||
    filters.direction !== "all" ||
    Boolean(filters.from) ||
    Boolean(filters.to);

  return (
    <>
      <PageHeader
        title="Messages"
        description="Every inbound message and every reply the gateway sent, with the provider that produced it."
        actions={
          <span className="tnum font-[var(--font-mono)] text-[12px] text-[var(--fg-subtle)]">
            {total.toLocaleString()} records
          </span>
        }
      />

      <Panel>
        <FilterBar searchPlaceholder="Search text, chat id, model…">
          <FilterSelect
            label="Direction"
            paramKey="direction"
            value={filters.direction ?? "all"}
            options={[
              { value: "all", label: "Both directions" },
              { value: "inbound", label: "Inbound" },
              { value: "outbound", label: "Outbound" },
            ]}
          />
          <FilterSelect
            label="Provider"
            paramKey="provider"
            value={filters.providerId ?? "all"}
            options={[
              { value: "all", label: "All providers" },
              ...providers.map((p) => ({ value: p.id, label: p.name })),
            ]}
          />
          <div className="hidden lg:block">
            <DateRangeFilter />
          </div>
        </FilterBar>

        {rows.length === 0 ? (
          <EmptyState
            icon={hasFilters ? <SearchX size={15} strokeWidth={1.7} /> : <MessageSquare size={15} strokeWidth={1.7} />}
            title={hasFilters ? "No messages match these filters" : "No messages yet"}
            description={
              hasFilters
                ? "Try a wider search, or clear the status and date filters."
                : "Messages appear here once an allowlisted chat talks to the bot. Register the webhook in Settings → Telegram to start receiving them."
            }
          />
        ) : (
          <>
            {/* Desktop table */}
            <div className="hidden md:block">
              <TableWrap>
                <thead>
                  <tr>
                    <Th className="w-[136px]">Time</Th>
                    <Th className="w-[84px]">Direction</Th>
                    <Th>Message</Th>
                    <Th className="w-[132px]">Provider</Th>
                    <Th className="w-[104px]">Status</Th>
                    <Th className="w-[84px]" align="right">
                      Latency
                    </Th>
                    <Th className="w-[110px]">Chat</Th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <Tr key={row.id} className="relative">
                      <Td>
                        <Link
                          href={`/messages/${row.id}`}
                          className="tnum font-[var(--font-mono)] text-[11.5px] text-[var(--fg-muted)] transition-colors after:absolute after:inset-0 hover:text-[var(--accent)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
                        >
                          {formatDateTime(row.createdAt)}
                        </Link>
                      </Td>
                      <Td>
                        <span className="inline-flex items-center gap-1.5 text-[12px] text-[var(--fg-muted)]">
                          <StatusDot
                            tone={row.direction === "inbound" ? "info" : "accent"}
                          />
                          {DIRECTION_LABEL[row.direction]}
                        </span>
                      </Td>
                      <Td>
                        <span
                          className="block max-w-[520px] truncate text-[12.5px] text-[var(--fg)]"
                          title={row.text}
                        >
                          {row.text}
                        </span>
                      </Td>
                      <Td>
                        {row.providerName ? (
                          <span className="block truncate text-[12px] text-[var(--fg-muted)]">
                            {row.providerName}
                            {row.model ? (
                              <span className="block truncate font-[var(--font-mono)] text-[10.5px] text-[var(--fg-subtle)]">
                                {row.model}
                              </span>
                            ) : null}
                          </span>
                        ) : (
                          <span className="text-[12px] text-[var(--fg-subtle)]">—</span>
                        )}
                      </Td>
                      <Td>
                        <Badge tone={messageTone(row.status)} dot>
                          {STATUS_LABEL[row.status]}
                        </Badge>
                      </Td>
                      <Td align="right">
                        <span className="tnum font-[var(--font-mono)] text-[11.5px] text-[var(--fg-muted)]">
                          {formatDuration(row.latencyMs)}
                        </span>
                      </Td>
                      <Td>
                        <span className="font-[var(--font-mono)] text-[11.5px] text-[var(--fg-subtle)]">
                          {row.chatId}
                        </span>
                      </Td>
                    </Tr>
                  ))}
                </tbody>
              </TableWrap>
            </div>

            {/* Mobile: a stacked list, because a 7-column table is unusable at 375px */}
            <ul className="divide-y divide-[var(--line-faint)] md:hidden">
              {rows.map((row) => (
                <li key={row.id}>
                  <Link
                    href={`/messages/${row.id}`}
                    className="block px-3.5 py-3 transition-colors hover:bg-[var(--surface-2)]"
                  >
                    <div className="flex items-center gap-2">
                      <StatusDot tone={messageTone(row.status)} />
                      <span className="text-[11.5px] text-[var(--fg-muted)]">
                        {DIRECTION_LABEL[row.direction]}
                      </span>
                      <span className="ml-auto font-[var(--font-mono)] text-[10.5px] text-[var(--fg-subtle)]">
                        {relativeTime(row.createdAt)}
                      </span>
                    </div>
                    <p className="mt-1.5 line-clamp-2 text-[12.5px] leading-[17px] text-[var(--fg)]">
                      {truncate(row.text, 180)}
                    </p>
                    <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 font-[var(--font-mono)] text-[10.5px] text-[var(--fg-subtle)]">
                      {row.providerName ? <span>{row.providerName}</span> : null}
                      {row.latencyMs ? <span>· {formatDuration(row.latencyMs)}</span> : null}
                      <span className="ml-auto">chat {row.chatId}</span>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>

            <Pagination page={page} perPage={perPage} total={total} />
          </>
        )}
      </Panel>
    </>
  );
}
