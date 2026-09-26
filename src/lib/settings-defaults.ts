/**
 * Default values for every tunable application setting.
 * Kept free of `server-only` so migration/seed scripts can import it under
 * plain Node.
 */
export const SETTING_DEFAULTS = {
  /** Conversation engine */
  maxHistoryMessages: "20",
  temperature: "0.7",
  maxTokens: "4096",
  retryAttempts: "2",
  /** Default per-request provider timeout when a provider has no own value. */
  providerTimeoutMs: "30000",
  /** Initial theme preference for a browser that has not chosen yet. */
  defaultTheme: "system",
} as const;

export type SettingKey = keyof typeof SETTING_DEFAULTS;
export type ThemePreference = "system" | "light" | "dark";
