CREATE TABLE `ai_providers` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`base_url` text NOT NULL,
	`api_key_encrypted` text,
	`model` text NOT NULL,
	`adapter` text DEFAULT 'openai-compatible' NOT NULL,
	`custom_headers_encrypted` text,
	`custom_body_template` text,
	`custom_response_path` text,
	`temperature` real,
	`max_tokens` integer,
	`timeout_ms` integer DEFAULT 30000 NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`is_primary` integer DEFAULT false NOT NULL,
	`priority` integer DEFAULT 0 NOT NULL,
	`input_cost_per_million` real,
	`output_cost_per_million` real,
	`last_tested_at` integer,
	`last_test_ok` integer,
	`last_test_http_status` integer,
	`last_test_latency_ms` integer,
	`last_test_error` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `ai_providers_priority_idx` ON `ai_providers` (`priority`);--> statement-breakpoint
CREATE INDEX `ai_providers_enabled_idx` ON `ai_providers` (`enabled`);--> statement-breakpoint
CREATE TABLE `ai_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`conversation_id` text,
	`chat_id` text NOT NULL,
	`trigger_message_id` text,
	`correlation_id` text NOT NULL,
	`trigger_text` text,
	`status` text DEFAULT 'running' NOT NULL,
	`provider_id` text,
	`provider_name` text,
	`model` text,
	`attempt_count` integer DEFAULT 0 NOT NULL,
	`fallback_count` integer DEFAULT 0 NOT NULL,
	`prompt_tokens` integer,
	`completion_tokens` integer,
	`total_tokens` integer,
	`estimated_cost` real,
	`total_latency_ms` integer,
	`telegram_delivered` integer,
	`telegram_error` text,
	`error_category` text,
	`error_message` text,
	`started_at` integer DEFAULT (unixepoch()) NOT NULL,
	`completed_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ai_requests_correlation_idx` ON `ai_requests` (`correlation_id`);--> statement-breakpoint
CREATE INDEX `ai_requests_conversation_idx` ON `ai_requests` (`conversation_id`,`started_at`);--> statement-breakpoint
CREATE INDEX `ai_requests_status_idx` ON `ai_requests` (`status`);--> statement-breakpoint
CREATE INDEX `ai_requests_started_idx` ON `ai_requests` (`started_at`);--> statement-breakpoint
CREATE TABLE `conversations` (
	`id` text PRIMARY KEY NOT NULL,
	`chat_id` text NOT NULL,
	`telegram_user_id` text,
	`username` text,
	`first_name` text,
	`last_name` text,
	`message_count` integer DEFAULT 0 NOT NULL,
	`last_message_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `conversations_chat_id_idx` ON `conversations` (`chat_id`);--> statement-breakpoint
CREATE INDEX `conversations_last_message_idx` ON `conversations` (`last_message_at`);--> statement-breakpoint
CREATE TABLE `logs` (
	`id` text PRIMARY KEY NOT NULL,
	`level` text DEFAULT 'INFO' NOT NULL,
	`category` text DEFAULT 'SYSTEM' NOT NULL,
	`event` text NOT NULL,
	`message` text,
	`correlation_id` text,
	`request_id` text,
	`provider_id` text,
	`chat_id` text,
	`http_status` integer,
	`duration_ms` integer,
	`meta` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `logs_created_idx` ON `logs` (`created_at`);--> statement-breakpoint
CREATE INDEX `logs_level_idx` ON `logs` (`level`,`created_at`);--> statement-breakpoint
CREATE INDEX `logs_category_idx` ON `logs` (`category`,`created_at`);--> statement-breakpoint
CREATE INDEX `logs_correlation_idx` ON `logs` (`correlation_id`);--> statement-breakpoint
CREATE TABLE `messages` (
	`id` text PRIMARY KEY NOT NULL,
	`conversation_id` text NOT NULL,
	`chat_id` text NOT NULL,
	`telegram_user_id` text,
	`direction` text NOT NULL,
	`text` text NOT NULL,
	`status` text NOT NULL,
	`provider_id` text,
	`provider_name` text,
	`model` text,
	`latency_ms` integer,
	`telegram_message_id` integer,
	`request_id` text,
	`error_category` text,
	`error_message` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `messages_conversation_idx` ON `messages` (`conversation_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `messages_chat_idx` ON `messages` (`chat_id`);--> statement-breakpoint
CREATE INDEX `messages_status_idx` ON `messages` (`status`);--> statement-breakpoint
CREATE INDEX `messages_created_idx` ON `messages` (`created_at`);--> statement-breakpoint
CREATE INDEX `messages_request_idx` ON `messages` (`request_id`);--> statement-breakpoint
CREATE TABLE `request_attempts` (
	`id` text PRIMARY KEY NOT NULL,
	`request_id` text NOT NULL,
	`provider_id` text NOT NULL,
	`provider_name` text NOT NULL,
	`model` text NOT NULL,
	`attempt_number` integer NOT NULL,
	`outcome` text NOT NULL,
	`http_status` integer,
	`duration_ms` integer DEFAULT 0 NOT NULL,
	`error_category` text,
	`error_message` text,
	`prompt_tokens` integer,
	`completion_tokens` integer,
	`started_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `request_attempts_request_idx` ON `request_attempts` (`request_id`,`attempt_number`);--> statement-breakpoint
CREATE INDEX `request_attempts_provider_idx` ON `request_attempts` (`provider_id`,`started_at`);--> statement-breakpoint
CREATE TABLE `request_events` (
	`id` text PRIMARY KEY NOT NULL,
	`request_id` text NOT NULL,
	`seq` integer NOT NULL,
	`event` text NOT NULL,
	`detail` text,
	`level` text DEFAULT 'info' NOT NULL,
	`duration_ms` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `request_events_request_seq_idx` ON `request_events` (`request_id`,`seq`);--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `telegram_config` (
	`id` integer PRIMARY KEY DEFAULT 1 NOT NULL,
	`bot_token_encrypted` text,
	`chat_id_1` text,
	`chat_id_2` text,
	`chat_id_3` text,
	`reply_to_unauthorized` integer DEFAULT false NOT NULL,
	`bot_username` text,
	`bot_display_name` text,
	`webhook_url` text,
	`webhook_pending_count` integer,
	`webhook_last_error` text,
	`last_checked_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `telegram_updates` (
	`update_id` integer PRIMARY KEY NOT NULL,
	`chat_id` text,
	`telegram_user_id` text,
	`status` text DEFAULT 'received' NOT NULL,
	`request_id` text,
	`reason` text,
	`received_at` integer DEFAULT (unixepoch()) NOT NULL,
	`processed_at` integer
);
