/** Mask anything that could carry a credential out of free text. */
const SECRET_PATTERNS: Array<[RegExp, string]> = [
  // `Authorization: Bearer xxx` / `x-api-key: xxx`
  [/(bearer\s+)[A-Za-z0-9._\-]{8,}/gi, "$1[redacted]"],
  [/(api[-_]?key"?\s*[:=]\s*"?)[^",\s}]{6,}/gi, "$1[redacted]"],
  [/(x-api-key"?\s*[:=]\s*"?)[^",\s}]{6,}/gi, "$1[redacted]"],
  // Telegram bot tokens: 123456789:AA...
  [/\b\d{6,12}:[A-Za-z0-9_-]{20,}\b/g, "[redacted-bot-token]"],
  // Vendor key shapes
  [/\bsk-[A-Za-z0-9_-]{16,}\b/g, "[redacted]"],
  [/\bAIza[0-9A-Za-z_-]{20,}\b/g, "[redacted]"],
  // libsql / turso tokens
  [/\beyJ[A-Za-z0-9._-]{20,}\b/g, "[redacted]"],
];

const HEADER_DENYLIST = new Set([
  "authorization",
  "proxy-authorization",
  "x-api-key",
  "api-key",
  "x-goog-api-key",
  "cookie",
  "set-cookie",
]);

/** Strips credentials from an arbitrary error/body string before it is stored or shown. */
export function sanitizeText(input: string | null | undefined, maxLen = 2000): string {
  if (!input) return "";
  let out = input;
  for (const [pattern, replacement] of SECRET_PATTERNS) {
    out = out.replace(pattern, replacement);
  }
  if (out.length > maxLen) out = `${out.slice(0, maxLen)}…`;
  return out;
}

/** Removes sensitive headers entirely rather than masking their values. */
export function sanitizeHeaders(
  headers: Record<string, string> | undefined | null,
): Record<string, string> | null {
  if (!headers) return null;
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    out[key] = HEADER_DENYLIST.has(key.toLowerCase()) ? "[redacted]" : sanitizeText(value, 500);
  }
  return out;
}

/** Deeply sanitises a JSON-ish value for the `meta` column. */
export function sanitizeMeta(value: unknown, depth = 0): unknown {
  if (depth > 4) return "[truncated]";
  if (value === null || value === undefined) return value ?? null;
  if (typeof value === "string") return sanitizeText(value, 1000);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.slice(0, 20).map((v) => sanitizeMeta(v, depth + 1));
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      out[key] = HEADER_DENYLIST.has(key.toLowerCase())
        ? "[redacted]"
        : sanitizeMeta(val, depth + 1);
    }
    return out;
  }
  return String(value);
}

/** Human-facing one-liner for a failed call. */
export function safeErrorMessage(error: unknown, fallback = "Unknown error"): string {
  if (error instanceof Error && error.message) return sanitizeText(error.message, 300);
  if (typeof error === "string" && error) return sanitizeText(error, 300);
  return fallback;
}
