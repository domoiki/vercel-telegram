import { beforeEach, describe, expect, it, vi } from "vitest";

import { SETTING_DEFAULTS } from "./settings-defaults";

const rows: Array<{ key: string; value: string }> = [];
const written: Array<{ key: string; value: string }> = [];

vi.mock("./db", () => ({
  getDb: () => ({
    select: () => ({
      // A thenable, as Drizzle's query builder is.
      from: () => ({ then: (resolve: (v: unknown) => void) => resolve([...rows]) }),
    }),
    insert: () => {
      let pending: { key: string; value: string } | null = null;
      const chain = {
        values: (v: { key: string; value: string }) => {
          pending = v;
          return {
            onConflictDoNothing: async () => {
              if (pending && !rows.some((r) => r.key === pending!.key)) rows.push({ ...pending });
            },
            onConflictDoUpdate: async () => {
              if (!pending) return;
              const existing = rows.find((r) => r.key === pending!.key);
              if (existing) existing.value = pending.value;
              else rows.push({ ...pending });
              written.push({ key: pending.key, value: pending.value });
            },
          };
        },
      };
      return chain;
    },
    update: () => ({ set: () => ({ where: async () => undefined }) }),
  }),
  schema: { settings: {}, telegramConfig: { id: {} } },
}));

const { getSettings, setSetting } = await import("./settings");

beforeEach(() => {
  rows.length = 0;
  written.length = 0;
});

describe("getSettings", () => {
  it("returns the shipped defaults when the table is empty", async () => {
    const settings = await getSettings();
    expect(settings.maxHistoryMessages).toBe(Number(SETTING_DEFAULTS.maxHistoryMessages));
    expect(settings.temperature).toBe(Number(SETTING_DEFAULTS.temperature));
    expect(settings.maxTokens).toBe(Number(SETTING_DEFAULTS.maxTokens));
    expect(settings.retryAttempts).toBe(Number(SETTING_DEFAULTS.retryAttempts));
    expect(settings.providerTimeoutMs).toBe(Number(SETTING_DEFAULTS.providerTimeoutMs));
    expect(settings.defaultTheme).toBe("system");
  });

  it("returns the values the dashboard saved", async () => {
    // Regression: the read path once looked rows up by their default *value*,
    // so every save was silently ignored and the defaults always won.
    rows.push(
      { key: "maxHistoryMessages", value: "8" },
      { key: "temperature", value: "1.4" },
      { key: "maxTokens", value: "2048" },
      { key: "retryAttempts", value: "0" },
      { key: "providerTimeoutMs", value: "12000" },
      { key: "defaultTheme", value: "dark" },
    );
    const settings = await getSettings();
    expect(settings).toEqual({
      maxHistoryMessages: 8,
      temperature: 1.4,
      maxTokens: 2048,
      retryAttempts: 0,
      providerTimeoutMs: 12_000,
      defaultTheme: "dark",
    });
  });

  it("keeps a zero retry budget instead of treating it as missing", async () => {
    rows.push({ key: "retryAttempts", value: "0" });
    expect((await getSettings()).retryAttempts).toBe(0);
  });

  it("clamps a value that is out of range", async () => {
    rows.push(
      { key: "maxHistoryMessages", value: "99999" },
      { key: "providerTimeoutMs", value: "1" },
      { key: "temperature", value: "9" },
    );
    const settings = await getSettings();
    expect(settings.maxHistoryMessages).toBe(200);
    expect(settings.providerTimeoutMs).toBe(1000);
    expect(settings.temperature).toBe(2);
  });

  it("falls back when a stored value cannot be parsed", async () => {
    rows.push({ key: "maxTokens", value: "not-a-number" });
    expect((await getSettings()).maxTokens).toBe(Number(SETTING_DEFAULTS.maxTokens));
  });

  it("rejects an unrecognised theme value", async () => {
    rows.push({ key: "defaultTheme", value: "neon" });
    expect((await getSettings()).defaultTheme).toBe("system");
  });

  it("accepts every valid theme value", async () => {
    for (const theme of ["light", "dark", "system"] as const) {
      rows.length = 0;
      rows.push({ key: "defaultTheme", value: theme });
      expect((await getSettings()).defaultTheme).toBe(theme);
    }
  });

  it("accepts light and dark themes", async () => {
    rows.push({ key: "defaultTheme", value: "light" });
    expect((await getSettings()).defaultTheme).toBe("light");
  });
});

describe("setSetting", () => {
  it("round-trips a saved value through getSettings", async () => {
    await setSetting("retryAttempts", "4");
    expect(written).toEqual([{ key: "retryAttempts", value: "4" }]);
    expect((await getSettings()).retryAttempts).toBe(4);
  });

  it("updates an existing value rather than adding a second row", async () => {
    rows.push({ key: "temperature", value: "0.7" });
    await setSetting("temperature", "1.2");
    expect(rows.filter((r) => r.key === "temperature")).toHaveLength(1);
    expect((await getSettings()).temperature).toBe(1.2);
  });

  it("saves the theme preference that the server reads back", async () => {
    await setSetting("defaultTheme", "dark");
    expect((await getSettings()).defaultTheme).toBe("dark");
  });

  it("keeps other settings untouched", async () => {
    rows.push({ key: "maxTokens", value: "2048" });
    await setSetting("retryAttempts", "0");
    expect((await getSettings()).maxTokens).toBe(2048);
  });
});

describe("SETTING_DEFAULTS", () => {
  it("names every key it is responsible for", () => {
    expect(Object.keys(SETTING_DEFAULTS).sort()).toEqual([
      "defaultTheme",
      "maxHistoryMessages",
      "maxTokens",
      "providerTimeoutMs",
      "retryAttempts",
      "temperature",
    ]);
    for (const value of Object.values(SETTING_DEFAULTS)) {
      expect(typeof value).toBe("string");
      expect(value.length).toBeGreaterThan(0);
    }
  });
});
