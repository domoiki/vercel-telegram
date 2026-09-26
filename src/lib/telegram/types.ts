/** Telegram Bot API update shapes we care about. */

export type TelegramUser = {
  id: number;
  is_bot?: boolean;
  first_name?: string;
  last_name?: string;
  username?: string;
  language_code?: string;
};

export type TelegramChat = {
  id: number;
  type?: "private" | "group" | "supergroup" | "channel";
  title?: string;
  username?: string;
  first_name?: string;
  last_name?: string;
};

export type TelegramMessage = {
  message_id: number;
  date?: number;
  chat: TelegramChat;
  from?: TelegramUser;
  text?: string;
  caption?: string;
  photo?: unknown[];
  document?: unknown;
  voice?: unknown;
  reply_to_message?: TelegramMessage;
};

export type TelegramUpdate = {
  update_id: number;
  message?: TelegramMessage;
  edited_message?: TelegramMessage;
  channel_post?: TelegramMessage;
};

export type WebhookInfo = {
  url: string;
  has_custom_certificate: boolean;
  pending_update_count: number;
  last_error_date?: number;
  last_error_message?: string;
  max_connections?: number;
  ip_address?: string;
  allowed_updates?: string[];
};

export type BotInfo = {
  id: number;
  is_bot: boolean;
  first_name: string;
  username: string;
  can_join_groups?: boolean;
  can_read_all_group_messages?: boolean;
  supports_inline_queries?: boolean;
};

/** Normalised, validated inbound message. */
export type ParsedTelegramMessage = {
  updateId: number;
  messageId: number;
  chatId: string;
  chatType: string;
  userId: string | null;
  username: string | null;
  firstName: string | null;
  lastName: string | null;
  text: string;
  date: Date | null;
  isCommand: boolean;
  commandName: string | null;
};
