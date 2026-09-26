import Link from "next/link";
import type { Metadata } from "next";
import { Activity } from "lucide-react";

import { DateRangeFilter, FilterBar, FilterSelect, Pagination } from "@/components/filters/filter-bar";
import { Badge, StatusDot } from "@/components/ui/badge";
import { PageHeader, Panel } from "@/components/ui/panel";
import { EmptyState, TableWrap, Td, Th, Tr } from "@/components/ui/table";
import type { LogLevel } from "@/lib/db/schema";
import { formatDateTimeSeconds, formatDuration, truncate } from "@/lib/format";
import { getLogs } from "@/lib/queries";
import { logTone } from "@/lib/status";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Logs" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const single = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

export default async function LogsPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const filters = {
    search: single(params.q),
    level: (single(params.level) as LogLevel | "all" | undefined) ?? "all",
    category: single(params.category) ?? "all",
    correlationId: single(params.correlationId),
    from: single(params.from),
    to: single(params.to),
    page: Number(single(params.page) ?? 1) || 1,
    perPage: 50,
  };

  const { rows, total, page, perPage } = await getLogs(filters);
  const hasFilters = Boolean(filters.search) || filters.level !== "all" || filters.category !== "all";

  return (
    <>
      <PageHeader
        title="Logs"
        description="Structured events from the webhook, providers and Telegram. Credentials are stripped before anything is written here."
        actions={
          <span className="tnum font-[var(--font-mono)] text-[12px] text-[var(--fg-subtle)]">
            {total.toLocaleString()} entries
          </span>
        }
      />

      <Panel>
        <FilterBar searchPlaceholder="Search event, message, trace id…">
          <FilterSelect
            label="Category"
            paramKey="category"
            value={filters.category ?? "all"}
            options={[
              { value: "all", label: "All categories" },
              { value: "SYSTEM", label: "System" },
              { value: "WEBHOOK", label: "Webhook" },
              { value: "TELEGRAM", label: "Telegram" },
              { value: "AI", label: "AI" },
              { value: "API", label: "API" },
              { value: "DATABASE", label: "Database" },
            ]}
          />
          <div className="hidden lg:block">
            <DateRangeFilter />
          </div>
        </FilterBar>

        {rows.length === 0 ? (
          <EmptyState
            icon={<Activity size={15} strokeWidth={1.7} />}
            title={hasFilters ? "No log entries match" : "No log entries yet"}
            description={
              hasFilters
                ? "Try clearing the level or category filter."
                : "Gateway activity, provider calls and Telegram errors are recorded here as they happen."
            }
          />
        ) : (
          <>
            <div className="hidden lg:block">
              <TableWrap>
                <thead>
                  <tr>
                    <Th className="w-[150px]">Time</Th>
                    <Th className="w-[80px]">Level</Th>
                    <Th className="w-[96px]">Category</Th>
                    <Th className="w-[220px]">Event</Th>
                    <Th>Message</Th>
                    <Th className="w-[104px]">Status</Th>
                    <Th className="w-[76px]" align="right">
                      Duration
                    </Th>
                    <Th className="w-[84px]">Trace</Th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <Tr key={row.id}>
                      <Td>
                        <span className="tnum font-[var(--font-mono)] text-[11px] text-[var(--fg-muted)]">
                          {formatDateTimeSeconds(row.createdAt)}
                        </span>
                      </Td>
                      <Td>
                        <span className="inline-flex items-center gap-1.5">
                          <StatusDot tone={logTone(row.level)} />
                          <span className="text-[11.5px] text-[var(--fg-muted)]">{row.level}</span>
                        </span>
                      </Td>
                      <Td>
                        <span className="font-[var(--font-mono)] text-[11px] text-[var(--fg-subtle)]">
                          {row.category}
                        </span>
                      </Td>
                      <Td>
                        <span
                          className="block truncate font-[var(--font-mono)] text-[11.5px] text-[var(--fg)]"
                          title={row.event}
                        >
                          {row.event}
                        </span>
                      </Td>
                      <Td>
                        <span
                          className="block max-w-[460px] truncate text-[12px] text-[var(--fg-muted)]"
                          title={row.message ?? undefined}
                        >
                          {row.message ?? "—"}
                        </span>
                      </Td>
                      <Td>
                        {row.httpStatus !== null ? (
                          <Badge
                            tone={
                              row.httpStatus >= 500
                                ? "error"
                                : row.httpStatus >= 400
                                  ? "warning"
                                  : "success"
                            }
                            mono
                          >
                            {row.httpStatus}
                          </Badge>
                        ) : (
                          <span className="text-[12px] text-[var(--fg-subtle)]">—</span>
                        )}
                      </Td>
                      <Td align="right">
                        <span className="tnum font-[var(--font-mono)] text-[11px] text-[var(--fg-subtle)]">
                          {formatDuration(row.durationMs)}
                        </span>
                      </Td>
                      <Td>
                        {row.requestId ? (
                          <Link
                            href={`/requests/${row.requestId}`}
                            className="font-[var(--font-mono)] text-[11px] text-[var(--fg-muted)] transition-colors hover:text-[var(--accent)]"
                          >
                            {row.correlationId ?? "open"}
                          </Link>
                        ) : row.correlationId ? (
                          <span className="font-[var(--font-mono)] text-[11px] text-[var(--fg-subtle)]">
                            {row.correlationId}
                          </span>
                        ) : (
                          <span className="text-[12px] text-[var(--fg-subtle)]">—</span>
                        )}
                      </Td>
                    </Tr>
                  ))}
                </tbody>
              </TableWrap>
            </div>

            <ul className="divide-y divide-[var(--line-faint)] lg:hidden">
              {rows.map((row) => (
                <li key={row.id} className="px-3.5 py-2.5">
                  <div className="flex items-center gap-2">
                    <StatusDot tone={logTone(row.level)} />
                    <span className="truncate font-[var(--font-mono)] text-[11.5px] text-[var(--fg)]">
                      {row.event}
                    </span>
                    <span className="ml-auto shrink-0 font-[var(--font-mono)] text-[10.5px] text-[var(--fg-subtle)]">
                      {formatDateTimeSeconds(row.createdAt)}
                    </span>
                  </div>
                  {row.message ? (
                    <p className="mt-1 pl-3.5 text-[12px] leading-[16px] text-[var(--fg-muted)]">
                      {truncate(row.message, 160)}
                    </p>
                  ) : null}
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
