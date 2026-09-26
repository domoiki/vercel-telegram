import { describe, expect, it } from "vitest";

import { safeErrorMessage, sanitizeHeaders, sanitizeMeta, sanitizeText } from "./sanitize";

describe("sanitizeText", () => {
  it("returns an empty string for nothing", () => {
    expect(sanitizeText(null)).toBe("");
    expect(sanitizeText(undefined)).toBe("");
    expect(sanitizeText("")).toBe("");
  });

  it("redacts a bearer token", () => {
    const out = sanitizeText("Authorization: Bearer abcdef1234567890abcdef");
    expect(out).not.toContain("abcdef1234567890abcdef");
    expect(out).toContain("[redacted]");
  });

  it("redacts a Telegram bot token", () => {
    const token = "123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw";
    const out = sanitizeText(`Failed to verify ${token} on the webhook`);
    expect(out).not.toContain(token);
    expect(out).toContain("[redacted-bot-token]");
  });

  it("redacts an api key mentioned inline", () => {
    const out = sanitizeText('{"api_key": "sk-proj-abcdefghijklmnopqrstuvwxyz"}');
    expect(out).not.toContain("sk-proj-abcdefghijklmnopqrstuvwxyz");
  });

  it("redacts vendor key shapes", () => {
    expect(sanitizeText("key sk-abcdefghijklmnopqrstuvwxyz here")).toContain("[redacted]");
    expect(sanitizeText("AIzaSyA1234567890abcdefghijklmnop")).toContain("[redacted]");
    expect(sanitizeText("eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9")).toContain("[redacted]");
  });

  it("leaves ordinary text alone", () => {
    const message = "HTTP 503: the provider is overloaded, retrying in 2s";
    expect(sanitizeText(message)).toBe(message);
  });

  it("truncates very long text", () => {
    const out = sanitizeText("x".repeat(5000), 100);
    expect(out).toHaveLength(101);
    expect(out.endsWith("…")).toBe(true);
  });
});

describe("sanitizeHeaders", () => {
  it("returns null when there are no headers", () => {
    expect(sanitizeHeaders(null)).toBeNull();
    expect(sanitizeHeaders(undefined)).toBeNull();
  });

  it("redacts credential headers regardless of the casing used", () => {
    const out = sanitizeHeaders({
      Authorization: "Bearer supersecretvalue",
      "X-API-Key": "another-secret",
      cookie: "session=abc",
      "content-type": "application/json",
    });
    // Keys are matched case-insensitively but preserved as given.
    expect(out?.Authorization).toBe("[redacted]");
    expect(out?.["X-API-Key"]).toBe("[redacted]");
    expect(out?.cookie).toBe("[redacted]");
    expect(out?.["content-type"]).toBe("application/json");
  });

  it("catches a credential header spelled in lower case", () => {
    const out = sanitizeHeaders({ authorization: "Bearer supersecretvalue" });
    expect(out?.authorization).toBe("[redacted]");
  });

  it("scrubs secrets hiding inside an otherwise harmless header", () => {
    const out = sanitizeHeaders({ "x-trace": "Bearer abcdefghijklmnop" });
    expect(out?.["x-trace"]).not.toContain("abcdefghijklmnop");
  });
});

describe("sanitizeMeta", () => {
  it("keeps primitives", () => {
    expect(sanitizeMeta(42)).toBe(42);
    expect(sanitizeMeta(true)).toBe(true);
    expect(sanitizeMeta(null)).toBeNull();
  });

  it("redacts nested credentials", () => {
    const out = sanitizeMeta({
      request: {
        headers: { Authorization: "Bearer abcdefghijklmnop" },
        body: "token sk-abcdefghijklmnopqrstuv",
      },
    }) as Record<string, Record<string, Record<string, string>>>;
    expect(out.request?.headers?.Authorization).toBe("[redacted]");
    expect(out.request?.body).toContain("[redacted]");
  });

  it("stops recursing on deeply nested structures", () => {
    let deep: unknown = "leaf";
    for (let i = 0; i < 12; i += 1) deep = { deep };
    expect(() => sanitizeMeta(deep)).not.toThrow();
    expect(JSON.stringify(sanitizeMeta(deep))).toContain("[truncated]");
  });

  it("caps very long arrays", () => {
    expect((sanitizeMeta(Array.from({ length: 100 }, (_, i) => i)) as unknown[]).length).toBe(20);
  });
});

describe("safeErrorMessage", () => {
  it("uses an Error's message", () => {
    expect(safeErrorMessage(new Error("boom"))).toBe("boom");
  });

  it("sanitizes the message it uses", () => {
    const out = safeErrorMessage(new Error("token sk-abcdefghijklmnopqrstuv failed"));
    expect(out).not.toContain("sk-abcdefghijklmnopqrstuv");
  });

  it("accepts a raw string", () => {
    expect(safeErrorMessage("plain failure")).toBe("plain failure");
  });

  it("falls back for values that carry nothing useful", () => {
    expect(safeErrorMessage(undefined, "custom")).toBe("custom");
    expect(safeErrorMessage(null, "custom")).toBe("custom");
    expect(safeErrorMessage({}, "custom")).toBe("custom");
    expect(safeErrorMessage(new Error(""), "custom")).toBe("custom");
  });
});
