import "server-only";

import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import type { AiProviderRow, ErrorCategory } from "@/lib/db/schema";
import { newId } from "@/lib/ids";
import { trace } from "@/lib/trace";
import { getAdapter } from "./registry";
import { getProviderChain, toProviderConfig } from "./service";
import { ProviderError, type ChatMessage } from "./types";

export type AttemptRecord = {
  attemptNumber: number;
  providerId: string;
  providerName: string;
  model: string;
  outcome: "success" | "error";
  httpStatus: number | null;
  durationMs: number;
  errorCategory: ErrorCategory | null;
  errorMessage: string | null;
  promptTokens: number | null;
  completionTokens: number | null;
  startedAt: Date;
};

export type RouteResult =
  | {
      ok: true;
      text: string;
      providerId: string;
      providerName: string;
      model: string;
      httpStatus: number;
      durationMs: number;
      promptTokens: number | null;
      completionTokens: number | null;
      totalTokens: number | null;
      estimatedCost: number | null;
      attempts: AttemptRecord[];
      fallbackCount: number;
    }
  | {
      ok: false;
      attempts: AttemptRecord[];
      fallbackCount: number;
      errorCategory: ErrorCategory;
      errorMessage: string;
    };

export type RouteOptions = {
  requestId: string;
  messages: ChatMessage[];
  temperature?: number | null;
  maxTokens?: number | null;
  retryAttempts?: number;
  timeoutMs?: number;
};

function estimateCost(
  row: AiProviderRow,
  promptTokens: number | null,
  completionTokens: number | null,
): number | null {
  if (row.inputCostPerMillion === null && row.outputCostPerMillion === null) return null;
  const input = ((promptTokens ?? 0) / 1_000_000) * (row.inputCostPerMillion ?? 0);
  const output = ((completionTokens ?? 0) / 1_000_000) * (row.outputCostPerMillion ?? 0);
  return Number((input + output).toFixed(6));
}

/** Transient failures worth an immediate same-provider retry. */
function isRetryable(category: ErrorCategory): boolean {
  return (
    category === "timeout" ||
    category === "network" ||
    category === "rate_limit" ||
    category === "server_error"
  );
}

async function persistAttempt(requestId: string, attempt: AttemptRecord) {
  const db = getDb();
  await db.insert(schema.requestAttempts).values({
    id: newId(),
    requestId,
    providerId: attempt.providerId,
    providerName: attempt.providerName,
    model: attempt.model,
    attemptNumber: attempt.attemptNumber,
    outcome: attempt.outcome,
    httpStatus: attempt.httpStatus,
    durationMs: attempt.durationMs,
    errorCategory: attempt.errorCategory,
    errorMessage: attempt.errorMessage,
    promptTokens: attempt.promptTokens,
    completionTokens: attempt.completionTokens,
    startedAt: attempt.startedAt,
  });
}

/**
 * Runs one AI turn across the configured chain.
 *
 * Contract: a provider is retried in place only for transient failures; any
 * other failure-worthy error moves to the next provider immediately; a
 * non-fallback-worthy error (a rejected request) stops the chain so the chain is
 * never burned on a bad prompt.
 */
export async function executeWithFallback(options: RouteOptions): Promise<RouteResult> {
  const chain = await getProviderChain();
  const attempts: AttemptRecord[] = [];
  let attemptNumber = 0;

  if (chain.length === 0) {
    await trace(options.requestId, {
      event: "No providers available",
      detail:
        "No enabled provider is configured. Add one in Settings → AI Providers, or enable an existing provider.",
      level: "error",
    });
    return {
      ok: false,
      attempts,
      fallbackCount: 0,
      errorCategory: "config",
      errorMessage: "No AI provider is enabled.",
    };
  }

  const maxRetries = Math.max(0, options.retryAttempts ?? 0);
  let fallbackCount = 0;
  let lastError: ProviderError | null = null;

  for (const [providerIndex, row] of chain.entries()) {
    const adapter = getAdapter(row.adapter);
    const config = toProviderConfig(row);
    const perProviderTries = maxRetries + 1;

    for (let tryIndex = 0; tryIndex < perProviderTries; tryIndex += 1) {
      attemptNumber += 1;
      const startedAt = new Date();

      if (tryIndex === 0) {
        await trace(options.requestId, {
          event: "Provider selected",
          detail: `${row.name} · ${config.model} · ${row.adapter}${
            providerIndex > 0 ? ` (fallback ${providerIndex})` : ""
          }`,
        });
      } else {
        await trace(options.requestId, {
          event: "Retrying provider",
          detail: `${row.name} · attempt ${tryIndex + 1} of ${perProviderTries}`,
          level: "warning",
        });
      }

      try {
        const result = await adapter.complete(config, {
          messages: options.messages,
          model: config.model,
          temperature: options.temperature,
          maxTokens: options.maxTokens,
          timeoutMs: options.timeoutMs ?? config.timeoutMs,
        });

        const attempt: AttemptRecord = {
          attemptNumber,
          providerId: row.id,
          providerName: row.name,
          model: result.model,
          outcome: "success",
          httpStatus: result.httpStatus,
          durationMs: result.durationMs,
          errorCategory: null,
          errorMessage: null,
          promptTokens: result.promptTokens,
          completionTokens: result.completionTokens,
          startedAt,
        };
        attempts.push(attempt);
        await persistAttempt(options.requestId, attempt);

        await trace(options.requestId, {
          event: "AI response received",
          detail: `HTTP ${result.httpStatus} · ${result.durationMs}ms · ${
            result.totalTokens !== null ? `${result.totalTokens} tokens` : "token usage unavailable"
          }`,
          level: "success",
          durationMs: result.durationMs,
        });

        return {
          ok: true,
          text: result.text,
          providerId: row.id,
          providerName: row.name,
          model: result.model,
          httpStatus: result.httpStatus,
          durationMs: result.durationMs,
          promptTokens: result.promptTokens,
          completionTokens: result.completionTokens,
          totalTokens: result.totalTokens,
          estimatedCost: estimateCost(row, result.promptTokens, result.completionTokens),
          attempts,
          fallbackCount,
        };
      } catch (error) {
        const providerError =
          error instanceof ProviderError
            ? error
            : new ProviderError(
                error instanceof Error ? error.message : "Provider request failed",
                { category: "unknown", fallbackWorthy: true },
              );

        const attempt: AttemptRecord = {
          attemptNumber,
          providerId: row.id,
          providerName: row.name,
          model: config.model,
          outcome: "error",
          httpStatus: providerError.httpStatus,
          durationMs: Date.now() - startedAt.getTime(),
          errorCategory: providerError.category,
          errorMessage: providerError.message,
          promptTokens: null,
          completionTokens: null,
          startedAt,
        };
        attempts.push(attempt);
        await persistAttempt(options.requestId, attempt);
        lastError = providerError;

        await trace(options.requestId, {
          event:
            providerError.httpStatus !== null
              ? `Provider returned ${providerError.httpStatus}`
              : `Provider failed (${providerError.category})`,
          detail: providerError.message,
          level: "error",
          durationMs: attempt.durationMs,
        });

        if (!providerError.fallbackWorthy) {
          await trace(options.requestId, {
            event: "Fallback skipped",
            detail: `The provider rejected the request, so the chain was not continued: ${providerError.category}.`,
            level: "warning",
          });
          return {
            ok: false,
            attempts,
            fallbackCount,
            errorCategory: providerError.category,
            errorMessage: providerError.message,
          };
        }

        const willRetry = tryIndex < perProviderTries - 1 && isRetryable(providerError.category);
        if (willRetry) continue;

        break;
      }
    }

    const nextRow = chain[providerIndex + 1];
    if (nextRow) {
      fallbackCount += 1;
      await trace(options.requestId, {
        event: "Fallback triggered",
        detail: `${row.name} failed with ${
          lastError?.httpStatus !== null && lastError?.httpStatus !== undefined
            ? `HTTP ${lastError.httpStatus}`
            : (lastError?.category ?? "an error")
        }. Trying ${nextRow.name}.`,
        level: "warning",
      });
    }
  }

  return {
    ok: false,
    attempts,
    fallbackCount,
    errorCategory: lastError?.category ?? "unknown",
    errorMessage: lastError?.message ?? "Every configured provider failed.",
  };
}

/** Marks a request row as finished. Kept here so callers share one shape. */
export async function finalizeRequest(
  requestId: string,
  patch: Partial<typeof schema.aiRequests.$inferInsert>,
) {
  const db = getDb();
  await db.update(schema.aiRequests).set(patch).where(eq(schema.aiRequests.id, requestId));
}
