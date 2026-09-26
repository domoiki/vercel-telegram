/**
 * Database schema.
 *
 * Naming: singular snake_case tables (matches Turso/SQLite conventions).
 * Every row id is a UUID string generated in application code so the same
 * schema works on Turso and on a local `file:` database.
 */
import { sql } from "drizzle-orm";
import {
  index,
  integer,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

const now = sql`(unixepoch())`;

export const MESSAGE_DIRECTIONS = ["inbound", "outbound"] as const;
export const MESSAGE_STATUSES = [
  "received",
  "processing",
  "delivered",
  "failed",
  "skipped",
] as const;
export const REQUEST_STATUSES = [
  "running",
  "succeeded",
  "failed",
] as const;
export const ATTEMPT_OUTCOMES = ["success", "error"] as const;
export const ERROR_CATEGORIES = [
  "timeout",
  "network",
  "rate_limit",
  "server_error",
  "auth",
  "bad_request",
  "config",
  "telegram",
  "database",
  "validation",
  "unknown",
] as const;
export const LOG_LEVELS = ["DEBUG", "INFO", "WARNING", "ERROR"] as const;
export const LOG_CATEGORIES = [
  "SYSTEM",
  "TELEGRAM",
  "AI",
  "API",
  "WEBHOOK",
  "DATABASE",
] as const;
export const EVENT_LEVELS = ["info", "success", "warning", "error"] as const;

export type MessageDirection = (typeof MESSAGE_DIRECTIONS)[number];
export type MessageStatus = (typeof MESSAGE_STATUSES)[number];
export type RequestStatus = (typeof REQUEST_STATUSES)[number];
export type AttemptOutcome = (typeof ATTEMPT_OUTCOMES)[number];
export type ErrorCategory = (typeof ERROR_CATEGORIES)[number];
export type LogLevel = (typeof LOG_LEVELS)[number];
export type LogCategory = (typeof LOG_CATEGORIES)[number];
export type EventLevel = (typeof EVENT_LEVELS)[number];

/** Key/value application settings. Seeded with defaults by `npm run db:seed`. */
export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .default(now),
});

/** Exactly one bot token and exactly three target chat id slots. */
export const telegramConfig = sqliteTable("telegram_config", {
  id: integer("id").primaryKey().default(1),
  /** AES-256-GCM ciphertext, `iv.tag.ciphertext`, base64. Never leaves the server. */
  botTokenEncrypted: text("bot_token_encrypted"),
  chatId1: text("chat_id_1"),
  chatId2: text("chat_id_2"),
  chatId3: text("chat_id_3"),
  /** Reply with a short "not authorized" notice instead of silently dropping. */
  replyToUnauthorized: integer("reply_to_unauthorized", { mode: "boolean" })
    .notNull()
    .default(false),
  /** Denormalised results of the last getMe / getWebhookInfo call (no secrets). */
  botUsername: text("bot_username"),
  botDisplayName: text("bot_display_name"),
  webhookUrl: text("webhook_url"),
  webhookPendingCount: integer("webhook_pending_count"),
  webhookLastError: text("webhook_last_error"),
  lastCheckedAt: integer("last_checked_at", { mode: "timestamp" }),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .default(now),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .default(now),
});

/** Dynamic, user-managed provider registry. Count is unbounded. */
export const aiProviders = sqliteTable(
  "ai_providers",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    description: text("description"),
    /** Base URL, e.g. https://api.openai.com/v1 */
    baseUrl: text("base_url").notNull(),
    /** AES-256-GCM ciphertext, `iv.tag.ciphertext`, base64. Never leaves the server. */
    apiKeyEncrypted: text("api_key_encrypted"),
    model: text("model").notNull(),
    /** openai-compatible | anthropic | gemini | custom-http */
    adapter: text("adapter").notNull().default("openai-compatible"),
    /** AES-256-GCM ciphertext of a JSON object of extra request headers. */
    customHeadersEncrypted: text("custom_headers_encrypted"),
    /**
     * Only used by the `custom-http` adapter. A JSON object whose values may be
     * the placeholders `{{messages}}`, `{{model}}`, `{{temperature}}`,
     * `{{maxTokens}}` and `{{system}}`.
     */
    customBodyTemplate: text("custom_body_template"),
    /** Dot path to the reply text inside a custom-http response, e.g. `data.answer`. */
    customResponsePath: text("custom_response_path"),
    temperature: real("temperature"),
    maxTokens: integer("max_tokens"),
    timeoutMs: integer("timeout_ms").notNull().default(30_000),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
    isPrimary: integer("is_primary", { mode: "boolean" }).notNull().default(false),
    /** Ascending order of the fallback chain. Lower runs first. */
    priority: integer("priority").notNull().default(0),
    /** Optional cost hints, USD per 1M tokens, used for estimated cost. */
    inputCostPerMillion: real("input_cost_per_million"),
    outputCostPerMillion: real("output_cost_per_million"),
    lastTestedAt: integer("last_tested_at", { mode: "timestamp" }),
    lastTestOk: integer("last_test_ok", { mode: "boolean" }),
    lastTestHttpStatus: integer("last_test_http_status"),
    lastTestLatencyMs: integer("last_test_latency_ms"),
    lastTestError: text("last_test_error"),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(now),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .notNull()
      .default(now),
  },
  (t) => [
    index("ai_providers_priority_idx").on(t.priority),
    index("ai_providers_enabled_idx").on(t.enabled),
  ],
);

/** One row per allowlisted chat. Created lazily on the first inbound message. */
export const conversations = sqliteTable(
  "conversations",
  {
    id: text("id").primaryKey(),
    chatId: text("chat_id").notNull(),
    telegramUserId: text("telegram_user_id"),
    username: text("username"),
    firstName: text("first_name"),
    lastName: text("last_name"),
    messageCount: integer("message_count").notNull().default(0),
    lastMessageAt: integer("last_message_at", { mode: "timestamp" }),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(now),
  },
  (t) => [
    uniqueIndex("conversations_chat_id_idx").on(t.chatId),
    index("conversations_last_message_idx").on(t.lastMessageAt),
  ],
);

export const messages = sqliteTable(
  "messages",
  {
    id: text("id").primaryKey(),
    conversationId: text("conversation_id").notNull(),
    chatId: text("chat_id").notNull(),
    telegramUserId: text("telegram_user_id"),
    direction: text("direction", { enum: MESSAGE_DIRECTIONS }).notNull(),
    /** Message text (outbound) or message text/body (inbound). */
    text: text("text").notNull(),
    status: text("status", { enum: MESSAGE_STATUSES }).notNull(),
    providerId: text("provider_id"),
    providerName: text("provider_name"),
    model: text("model"),
    latencyMs: integer("latency_ms"),
    /** Telegram's message_id for delivered outbound messages. */
    telegramMessageId: integer("telegram_message_id"),
    requestId: text("request_id"),
    errorCategory: text("error_category"),
    errorMessage: text("error_message"),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(now),
  },
  (t) => [
    index("messages_conversation_idx").on(t.conversationId, t.createdAt),
    index("messages_chat_idx").on(t.chatId),
    index("messages_status_idx").on(t.status),
    index("messages_created_idx").on(t.createdAt),
    index("messages_request_idx").on(t.requestId),
  ],
);

/** One AI turn = one row here. The correlation ID is the row id. */
export const aiRequests = sqliteTable(
  "ai_requests",
  {
    id: text("id").primaryKey(),
    conversationId: text("conversation_id"),
    chatId: text("chat_id").notNull(),
    triggerMessageId: text("trigger_message_id"),
    /** Short, human-quotable trace id, e.g. `8F3A21`. Unique. */
    correlationId: text("correlation_id").notNull(),
    triggerText: text("trigger_text"),
    status: text("status", { enum: REQUEST_STATUSES })
      .notNull()
      .default("running"),
    providerId: text("provider_id"),
    providerName: text("provider_name"),
    model: text("model"),
    attemptCount: integer("attempt_count").notNull().default(0),
    fallbackCount: integer("fallback_count").notNull().default(0),
    promptTokens: integer("prompt_tokens"),
    completionTokens: integer("completion_tokens"),
    totalTokens: integer("total_tokens"),
    estimatedCost: real("estimated_cost"),
    totalLatencyMs: integer("total_latency_ms"),
    telegramDelivered: integer("telegram_delivered", { mode: "boolean" }),
    telegramError: text("telegram_error"),
    errorCategory: text("error_category"),
    errorMessage: text("error_message"),
    startedAt: integer("started_at", { mode: "timestamp" })
      .notNull()
      .default(now),
    completedAt: integer("completed_at", { mode: "timestamp" }),
  },
  (t) => [
    uniqueIndex("ai_requests_correlation_idx").on(t.correlationId),
    index("ai_requests_conversation_idx").on(t.conversationId, t.startedAt),
    index("ai_requests_status_idx").on(t.status),
    index("ai_requests_started_idx").on(t.startedAt),
  ],
);

/** Every provider call, including the ones that failed and triggered fallback. */
export const requestAttempts = sqliteTable(
  "request_attempts",
  {
    id: text("id").primaryKey(),
    requestId: text("request_id").notNull(),
    providerId: text("provider_id").notNull(),
    providerName: text("provider_name").notNull(),
    model: text("model").notNull(),
    attemptNumber: integer("attempt_number").notNull(),
    outcome: text("outcome", { enum: ATTEMPT_OUTCOMES }).notNull(),
    httpStatus: integer("http_status"),
    durationMs: integer("duration_ms").notNull().default(0),
    errorCategory: text("error_category"),
    errorMessage: text("error_message"),
    promptTokens: integer("prompt_tokens"),
    completionTokens: integer("completion_tokens"),
    startedAt: integer("started_at", { mode: "timestamp" })
      .notNull()
      .default(now),
  },
  (t) => [
    index("request_attempts_request_idx").on(t.requestId, t.attemptNumber),
    index("request_attempts_provider_idx").on(t.providerId, t.startedAt),
  ],
);

/** The execution timeline rendered in the UI. */
export const requestEvents = sqliteTable(
  "request_events",
  {
    id: text("id").primaryKey(),
    requestId: text("request_id").notNull(),
    seq: integer("seq").notNull(),
    event: text("event").notNull(),
    detail: text("detail"),
    level: text("level", { enum: EVENT_LEVELS }).notNull().default("info"),
    durationMs: integer("duration_ms"),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(now),
  },
  (t) => [
    uniqueIndex("request_events_request_seq_idx").on(t.requestId, t.seq),
  ],
);

/**
 * Telegram `update_id` ledger — the idempotency guard.
 * The primary key is what makes a redelivered webhook a no-op.
 */
export const telegramUpdates = sqliteTable("telegram_updates", {
  updateId: integer("update_id").primaryKey(),
  chatId: text("chat_id"),
  telegramUserId: text("telegram_user_id"),
  status: text("status").notNull().default("received"),
  requestId: text("request_id"),
  reason: text("reason"),
  receivedAt: integer("received_at", { mode: "timestamp" })
    .notNull()
    .default(now),
  processedAt: integer("processed_at", { mode: "timestamp" }),
});

export const logs = sqliteTable(
  "logs",
  {
    id: text("id").primaryKey(),
    level: text("level", { enum: LOG_LEVELS }).notNull().default("INFO"),
    category: text("category", { enum: LOG_CATEGORIES }).notNull().default("SYSTEM"),
    event: text("event").notNull(),
    message: text("message"),
    correlationId: text("correlation_id"),
    requestId: text("request_id"),
    providerId: text("provider_id"),
    chatId: text("chat_id"),
    httpStatus: integer("http_status"),
    durationMs: integer("duration_ms"),
    /** Sanitised JSON detail. Secrets are stripped before it gets here. */
    meta: text("meta"),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(now),
  },
  (t) => [
    index("logs_created_idx").on(t.createdAt),
    index("logs_level_idx").on(t.level, t.createdAt),
    index("logs_category_idx").on(t.category, t.createdAt),
    index("logs_correlation_idx").on(t.correlationId),
  ],
);

export type TelegramConfigRow = typeof telegramConfig.$inferSelect;
export type AiProviderRow = typeof aiProviders.$inferSelect;
export type ConversationRow = typeof conversations.$inferSelect;
export type MessageRow = typeof messages.$inferSelect;
export type AiRequestRow = typeof aiRequests.$inferSelect;
export type RequestAttemptRow = typeof requestAttempts.$inferSelect;
export type RequestEventRow = typeof requestEvents.$inferSelect;
export type LogRow = typeof logs.$inferSelect;
export type SettingRow = typeof settings.$inferSelect;
