import Link from "next/link";
import type { Metadata } from "next";
import { MessagesSquare } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { PageHeader, Panel } from "@/components/ui/panel";
import { EmptyState, TableWrap, Td, Th, Tr } from "@/components/ui/table";
import { displayName, formatNumber, initials, relativeTime } from "@/lib/format";
import { getConversations } from "@/lib/queries";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Conversations" };

export default async function ConversationsPage() {
  const conversations = await getConversations(100);

  return (
    <>
      <PageHeader
        title="Conversations"
        description="One thread per allowlisted chat. History is what the gateway sends back to a provider as context."
        actions={
          <span className="tnum font-[var(--font-mono)] text-[12px] text-[var(--fg-subtle)]">
            {conversations.length} thread{conversations.length === 1 ? "" : "s"}
          </span>
        }
      />

      <Panel>
        {conversations.length === 0 ? (
          <EmptyState
            icon={<MessagesSquare size={15} strokeWidth={1.7} />}
            title="No conversations yet"
            description="A thread is created the first time an allowlisted chat sends a message to the bot."
            action={
              <Link
                href="/settings"
                className="inline-flex h-8.5 items-center rounded-[var(--radius-control)] bg-[var(--accent)] px-3 text-[13px] font-[550] text-[var(--accent-fg)] transition-colors hover:bg-[var(--accent-hover)] focus-visible:outline-2 focus-visible:outline-[var(--accent)] focus-visible:outline-offset-2"
              >
                Set up Telegram
              </Link>
            }
          />
        ) : (
          <>
            <div className="hidden md:block">
              <TableWrap>
                <thead>
                  <tr>
                    <Th>Chat</Th>
                    <Th className="w-[130px]">Chat ID</Th>
                    <Th className="w-[110px]" align="right">
                      Messages
                    </Th>
                    <Th className="w-[110px]">Failures</Th>
                    <Th className="w-[130px]" align="right">
                      Last activity
                    </Th>
                  </tr>
                </thead>
                <tbody>
                  {conversations.map((conversation) => (
                    <Tr key={conversation.id}>
                      <Td>
                        <Link
                          href={`/conversations/${conversation.id}`}
                          className="flex items-center gap-2.5 transition-colors hover:text-[var(--accent)]"
                        >
                          <span
                            aria-hidden
                            className="flex size-6 shrink-0 items-center justify-center rounded-[5px] border border-[var(--line)] bg-[var(--surface-2)] font-[var(--font-mono)] text-[10.5px] text-[var(--fg-muted)]"
                          >
                            {initials(conversation)}
                          </span>
                          <span className="min-w-0">
                            <span className="block truncate text-[12.5px] font-[550] text-[var(--fg)]">
                              {displayName(conversation)}
                            </span>
                            {conversation.username ? (
                              <span className="block truncate font-[var(--font-mono)] text-[10.5px] text-[var(--fg-subtle)]">
                                @{conversation.username}
                              </span>
                            ) : null}
                          </span>
                        </Link>
                      </Td>
                      <Td>
                        <span className="font-[var(--font-mono)] text-[11.5px] text-[var(--fg-muted)]">
                          {conversation.chatId}
                        </span>
                      </Td>
                      <Td align="right">
                        <span className="tnum font-[var(--font-mono)] text-[12px] text-[var(--fg-muted)]">
                          {formatNumber(conversation.messageCount)}
                        </span>
                      </Td>
                      <Td>
                        {Number(conversation.failedCount) > 0 ? (
                          <Badge tone="error" dot>
                            {formatNumber(conversation.failedCount)}
                          </Badge>
                        ) : (
                          <span className="text-[12px] text-[var(--fg-subtle)]">—</span>
                        )}
                      </Td>
                      <Td align="right">
                        <span className="text-[12px] text-[var(--fg-muted)]">
                          {relativeTime(conversation.lastMessageAt)}
                        </span>
                      </Td>
                    </Tr>
                  ))}
                </tbody>
              </TableWrap>
            </div>

            <ul className="divide-y divide-[var(--line-faint)] md:hidden">
              {conversations.map((conversation) => (
                <li key={conversation.id}>
                  <Link
                    href={`/conversations/${conversation.id}`}
                    className="flex items-center gap-3 px-3.5 py-3 transition-colors hover:bg-[var(--surface-2)]"
                  >
                    <span
                      aria-hidden
                      className="flex size-8 shrink-0 items-center justify-center rounded-[6px] border border-[var(--line)] bg-[var(--surface-2)] font-[var(--font-mono)] text-[11.5px] text-[var(--fg-muted)]"
                    >
                      {initials(conversation)}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-[550] text-[var(--fg)]">
                        {displayName(conversation)}
                      </span>
                      <span className="block truncate font-[var(--font-mono)] text-[10.5px] text-[var(--fg-subtle)]">
                        chat {conversation.chatId} · {conversation.messageCount} messages
                      </span>
                    </span>
                    <span className="shrink-0 text-[11.5px] text-[var(--fg-subtle)]">
                      {relativeTime(conversation.lastMessageAt)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </>
        )}
      </Panel>
    </>
  );
}
