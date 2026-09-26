/** Display formatting. Safe on both server and client. */

const dateTime = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

const dateTimeSeconds = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});

const timeOnly = new Intl.DateTimeFormat(undefined, {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});

const fullDate = new Intl.DateTimeFormat(undefined, {
  year: "numeric",
  month: "long",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

export function formatDateTime(value: Date | number | null | undefined): string {
  if (!value) return "—";
  return dateTime.format(toDate(value));
}

export function formatDateTimeSeconds(value: Date | number | null | undefined): string {
  if (!value) return "—";
  return dateTimeSeconds.format(toDate(value));
}

export function formatFullDate(value: Date | number | null | undefined): string {
  if (!value) return "—";
  return fullDate.format(toDate(value));
}

export function formatTime(value: Date | number | null | undefined): string {
  if (!value) return "—";
  return timeOnly.format(toDate(value));
}

function toDate(value: Date | number): Date {
  return value instanceof Date ? value : new Date(value * 1000);
}

/** "12s ago", "in 3m". Used where an exact timestamp would be noise. */
export function relativeTime(value: Date | number | null | undefined): string {
  if (!value) return "never";
  const target = toDate(value).getTime();
  const diffSeconds = Math.round((Date.now() - target) / 1000);
  const abs = Math.abs(diffSeconds);
  const suffix = diffSeconds >= 0 ? "ago" : "from now";
  if (abs < 10) return "just now";
  if (abs < 60) return `${abs}s ${suffix}`;
  const minutes = Math.round(abs / 60);
  if (minutes < 60) return `${minutes}m ${suffix}`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ${suffix}`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ${suffix}`;
  const months = Math.round(days / 30);
  return `${months}mo ${suffix}`;
}

export function formatDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return "—";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(ms < 10_000 ? 2 : 1)}s`;
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.round((ms % 60_000) / 1000);
  return `${minutes}m ${seconds}s`;
}

export function formatNumber(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return new Intl.NumberFormat().format(value);
}

export function formatCompact(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return new Intl.NumberFormat(undefined, {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}

export function formatCost(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  if (value === 0) return "$0.00";
  if (value < 0.0001) return "<$0.0001";
  if (value < 0.01) return `$${value.toFixed(4)}`;
  return `$${value.toFixed(2)}`;
}

export function formatPercent(value: number | null | undefined, digits = 0): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return `${value.toFixed(digits)}%`;
}

export function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

export function displayName(input: {
  firstName?: string | null;
  lastName?: string | null;
  username?: string | null;
}): string {
  const full = [input.firstName, input.lastName].filter(Boolean).join(" ").trim();
  if (full) return full;
  if (input.username) return `@${input.username}`;
  return "Unknown";
}

export function initials(input: {
  firstName?: string | null;
  lastName?: string | null;
  username?: string | null;
}): string {
  const source = input.firstName || input.username || "?";
  return source.replace(/^@/, "").slice(0, 2).toUpperCase();
}

export function titleCase(value: string): string {
  return value
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}

export function errorCategoryLabel(category: string | null | undefined): string {
  if (!category) return "Unknown";
  const map: Record<string, string> = {
    timeout: "Timeout",
    network: "Network",
    rate_limit: "Rate limited",
    server_error: "Server error",
    auth: "Credentials",
    bad_request: "Bad request",
    config: "Configuration",
    telegram: "Telegram",
    database: "Database",
    validation: "Validation",
    unknown: "Unknown",
  };
  return map[category] ?? titleCase(category);
}
