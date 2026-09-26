import { z } from "zod";

import { ADAPTER_IDS } from "@/lib/providers/shared";

/** Shared validation for the provider write endpoints. */
export const providerInputSchema = z.object({
  name: z.string().trim().min(1, "name is required").max(80),
  description: z.string().trim().max(300).optional().nullable(),
  baseUrl: z
    .string()
    .trim()
    .min(1, "endpoint is required")
    .refine((v) => /^https?:\/\//i.test(v), "endpoint must start with http:// or https://"),
  apiKey: z
    .string()
    .trim()
    .max(500)
    .optional()
    .nullable()
    .describe("Omit or leave blank to keep the stored key unchanged"),
  clearApiKey: z.boolean().optional(),
  model: z.string().trim().min(1, "model is required").max(160),
  adapter: z.enum(ADAPTER_IDS),
  customHeaders: z.record(z.string().max(300)).optional().nullable(),
  customBodyTemplate: z.string().trim().max(8000).optional().nullable(),
  customResponsePath: z.string().trim().max(200).optional().nullable(),
  temperature: z.number().min(0).max(2).optional().nullable(),
  maxTokens: z.number().int().min(16).max(200_000).optional().nullable(),
  timeoutMs: z.number().int().min(1000).max(120_000).optional(),
  enabled: z.boolean().optional(),
  isPrimary: z.boolean().optional(),
  inputCostPerMillion: z.number().min(0).max(10_000).optional().nullable(),
  outputCostPerMillion: z.number().min(0).max(10_000).optional().nullable(),
});

export type ProviderInput = z.infer<typeof providerInputSchema>;

export const settingsSchema = z.object({
  maxHistoryMessages: z.number().int().min(1).max(200),
  temperature: z.number().min(0).max(2),
  maxTokens: z.number().int().min(16).max(200_000),
  retryAttempts: z.number().int().min(0).max(10),
  providerTimeoutMs: z.number().int().min(1000).max(120_000),
  defaultTheme: z.enum(["system", "light", "dark"]),
});

export const telegramConfigSchema = z.object({
  /** Blank keeps the stored token. */
  botToken: z.string().trim().max(200).optional().nullable(),
  clearBotToken: z.boolean().optional(),
  chatId1: z
    .string()
    .trim()
    .max(40)
    .optional()
    .nullable()
    .refine((v) => v === undefined || v === null || v === "" || /^-?\d+$/.test(v), {
      message: "chat id must be numeric",
    }),
  chatId2: z
    .string()
    .trim()
    .max(40)
    .optional()
    .nullable()
    .refine((v) => v === undefined || v === null || v === "" || /^-?\d+$/.test(v), {
      message: "chat id must be numeric",
    }),
  chatId3: z
    .string()
    .trim()
    .max(40)
    .optional()
    .nullable()
    .refine((v) => v === undefined || v === null || v === "" || /^-?\d+$/.test(v), {
      message: "chat id must be numeric",
    }),
  replyToUnauthorized: z.boolean().optional(),
});

export const providerOrderSchema = z.object({
  ids: z.array(z.string().min(1)).max(200),
});
