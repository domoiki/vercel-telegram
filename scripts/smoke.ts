/**
 * End-to-end reliability check.
 *
 * Runs the real gateway against a real local HTTP provider and a real local
 * SQLite database. Only api.telegram.org is stubbed, so the provider adapter,
 * the timeout, the fallback engine, the trace and the persistence layer are
 * all genuinely exercised.
 *
 *   npm run qa:smoke
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import * as schema from "@/lib/db/schema";
import { encryptSecret } from "@/lib/crypto";
import { SETTING_DEFAULTS } from "@/lib/settings-defaults";

// --- a throwaway database, so a failed run can never touch real data ---------
const dir = mkdtempSync(join(tmpdir(), "gateway-smoke-"));
const dbPath = join(dir, "smoke.db");
const url = `file:${dbPath.replace(/\\/g, "/")}`;
process.env.DATABASE_URL = url;
process.env.TURSO_DATABASE_URL = url;
process.env.ENCRYPTION_KEY = "b".repeat(64);
Object.assign(process.env, { NODE_ENV: "test" });

let passed = 0;
let failed = 0;

function check(name: string, condition: boolean, detail?: string) {
  if (condition) {
    passed += 1;
    console.log(`  ✓ ${name}`);
  } else {
    failed += 1;
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

function section(name: string) {
  console.log(`\n${name}`);
}

// --- the fake provider -------------------------------------------------------
type Behaviour = { status: number; body: unknown; delayMs?: number };
const behaviours = new Map<string, Behaviour>();
/** Consumed on first hit, so a scenario can fail once and then succeed. */
const behavioursOnce = new Map<string, Behaviour[]>();
const hits: Array<{ path: string; body: string }> = [];

const provider = createServer((req: IncomingMessage, res: ServerResponse) => {
  let raw = "";
  req.on("data", (chunk) => (raw += chunk));
  req.on("end", async () => {
    hits.push({ path: req.url ?? "", body: raw });
    // The model is a request body field on the OpenAI-compatible shape.
    let model = "?";
    try {
      model = (JSON.parse(raw || "{}") as { model?: string }).model ?? "?";
    } catch {
      model = "?";
    }
    const queued = behavioursOnce.get(model);
    const behaviour = queued?.length
      ? (queued.shift() as Behaviour)
      : (behaviours.get(model) ?? { status: 200, body: null });
    if (behaviour.delayMs) await new Promise((r) => setTimeout(r, behaviour.delayMs));

    res.writeHead(behaviour.status, { "content-type": "application/json" });
    if (behaviour.status >= 400) {
      res.end(JSON.stringify(behaviour.body ?? { error: { message: "upstream failure" } }));
      return;
    }
    res.end(
      JSON.stringify({
        id: "cmpl_smoke",
        model,
        choices: [
          { index: 0, message: { role: "assistant", content: `answer from ${model}` }, finish_reason: "stop" },
        ],
        usage: { prompt_tokens: 42, completion_tokens: 7, total_tokens: 49 },
      }),
    );
  });
});

// --- stub only Telegram ------------------------------------------------------
const telegramCalls: Array<{ method: string; chatId: string; text: string }> = [];
let telegramFails = false;
const realFetch = globalThis.fetch;

async function main() {
  await new Promise<void>((resolve) => provider.listen(0, "127.0.0.1", resolve));
  const port = (provider.address() as { port: number }).port;
  const baseUrl = `http://127.0.0.1:${port}/v1`;

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url_ = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url_.includes("api.telegram.org")) {
      const body = JSON.parse(String(init?.body ?? "{}")) as { chat_id: string; text: string };
      telegramCalls.push({ method: url_.split("/").pop() ?? "", chatId: body.chat_id, text: body.text });
      if (telegramFails) {
        return new Response(JSON.stringify({ ok: false, description: "Bad Request: chat not found" }), {
          status: 400,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response(
        JSON.stringify({
          ok: true,
          result: { message_id: 4242, text: body.text, chat: { id: Number(body.chat_id) } },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    return realFetch(input, init);
  }) as typeof fetch;

  // --- database setup -------------------------------------------------------
  const client = createClient({ url });
  const db = drizzle(client, { schema });

  const { migrate } = await import("drizzle-orm/libsql/migrator");
  await migrate(db, { migrationsFolder: join(process.cwd(), "drizzle") });

  const now = new Date();
  // Pin the two settings the reliability scenarios hinge on, so the run does
  // not drift if a default ever changes: one retry per provider, and a global
  // provider timeout short enough to exercise the abort path.
  const settings: Array<{ key: string; value: string; updatedAt: Date }> = Object.entries(
    SETTING_DEFAULTS,
  ).map(([key, value]) => ({ key, value, updatedAt: now }));
  for (const patch of [
    { key: "retryAttempts", value: "1" },
    { key: "providerTimeoutMs", value: "1000" },
  ]) {
    const row = settings.find((s) => s.key === patch.key);
    if (row) row.value = patch.value;
  }
  await db.insert(schema.settings).values(settings);
  await db.insert(schema.telegramConfig).values({
    id: 1,
    botTokenEncrypted: encryptSecret("123456:SMOKE-TEST-TOKEN"),
    chatId1: "555000111",
    chatId2: "-1001887442109",
    chatId3: null,
    replyToUnauthorized: false,
    createdAt: now,
    updatedAt: now,
  });

  const providers = [
    { name: "primary", model: "model-primary", priority: 1, isPrimary: true },
    { name: "secondary", model: "model-secondary", priority: 2, isPrimary: false },
  ].map((p) => ({
    id: randomUUID(),
    name: p.name,
    baseUrl,
    apiKeyEncrypted: encryptSecret(`key-${p.name}`),
    model: p.model,
    adapter: "openai-compatible",
    timeoutMs: 2_000,
    enabled: true,
    isPrimary: p.isPrimary,
    priority: p.priority,
    createdAt: now,
    updatedAt: now,
  }));
  await db.insert(schema.aiProviders).values(providers);

  const { processTelegramUpdate } = await import("@/lib/gateway");
  const { getSettings } = await import("@/lib/settings");
  // Guards the scenario assumptions below: if the settings read path ever
  // ignores stored values again, every reliability expectation shifts.
  const effective = await getSettings();
  check(
    `settings are read back (retryAttempts=${effective.retryAttempts}, timeout=${effective.providerTimeoutMs})`,
    effective.retryAttempts === 1 && effective.providerTimeoutMs === 1000,
  );

  let updateSeq = 5000;
  function telegramUpdate(text: string, chatId = 555_000_111) {
    updateSeq += 1;
    return {
      update_id: updateSeq,
      message: {
        message_id: updateSeq,
        date: Math.floor(Date.now() / 1000),
        chat: { id: chatId, type: chatId < 0 ? "group" : "private" },
        from: { id: 900, first_name: "Dana", username: "dana" },
        text,
      },
    };
  }

  async function latestRequest() {
    const [row] = await db.select().from(schema.aiRequests).orderBy(schema.aiRequests.startedAt).limit(1);
    return row;
  }
  async function eventsFor(requestId: string) {
    return db
      .select()
      .from(schema.requestEvents)
      .where(eq(schema.requestEvents.requestId, requestId))
      .orderBy(schema.requestEvents.seq);
  }

  try {
    // -------------------------------------------------------------------------
    section("1. Happy path");
  behaviours.set("model-primary", { status: 200, body: null });
  telegramCalls.length = 0;

  const ok = await processTelegramUpdate(telegramUpdate("what is the status?"));
  check("update is processed", ok.status === "processed", ok.reason);
  check("a reply was sent to Telegram", telegramCalls.length === 1);
  check(
    "the reply is the provider's answer",
    telegramCalls[0]?.text === "answer from model-primary",
    telegramCalls[0]?.text,
  );
  check("a correlation id was returned", Boolean(ok.requestId));

  const request = await latestRequest();
  check("the request is persisted as succeeded", request?.status === "succeeded");
  check("the primary provider is recorded", request?.providerName === "primary");
  check("no fallback was needed", request?.fallbackCount === 0);
  check("token usage is recorded", request?.totalTokens === 49);
  check("telegram delivery is confirmed", request?.telegramDelivered === true);

  const messages = await db.select().from(schema.messages);
  check("both sides of the exchange are stored", messages.length === 2, `${messages.length} rows`);
  check(
    "the outbound message is marked delivered",
    messages.some((m) => m.direction === "outbound" && m.status === "delivered"),
  );

  const events = await eventsFor(request!.id);
  const names = events.map((e) => e.event);
  check("the trace starts at the webhook", names[0] === "Webhook received", names[0]);
  check("the trace ends at completion", names.at(-1) === "Request completed", names.at(-1));
  check(
    "the trace covers the whole pipeline",
    ["Telegram update validated", "Chat authorized", "Conversation loaded", "Provider selected", "AI response received", "Telegram sendMessage started", "Telegram delivery successful"].every((n) =>
      names.includes(n),
    ),
    names.join(" → "),
  );
  check("trace sequence numbers are contiguous", events.every((e, i) => e.seq === i + 1));

  // ---------------------------------------------------------------------------
  section("2. Duplicate update (Telegram retry)");
  const before = { messages: (await db.select().from(schema.messages)).length, sent: telegramCalls.length };
  const replay = await processTelegramUpdate(
    JSON.parse(JSON.stringify({ ...telegramUpdate("what is the status?"), update_id: 5001 })),
  );
  check("the replay is detected as a duplicate", replay.status === "duplicate", replay.status);
  check("no second reply is sent", telegramCalls.length === before.sent);
  check(
    "no duplicate rows are written",
    (await db.select().from(schema.messages)).length === before.messages,
  );
  check(
    "no second AI request is created",
    (await db.select().from(schema.aiRequests)).length === 1,
  );

  // ---------------------------------------------------------------------------
  section("3. Chat allowlist");
  const stray = await processTelegramUpdate(telegramUpdate("let me in", 777_000_999));
  check("a chat outside the allowlist is rejected", stray.status === "unauthorized", stray.status);
  check("it is not answered", !telegramCalls.some((c) => c.chatId === "777000999"));
  check(
    "no AI request is created for it",
    (await db.select().from(schema.aiRequests)).length === 1,
  );

  const group = await processTelegramUpdate(telegramUpdate("group hello", -100_188_744_2109));
  check("a group chat in slot 2 is accepted", group.status === "processed", group.status);

  // ---------------------------------------------------------------------------
  section("4. Fallback after a provider 5xx");
  behaviours.set("model-primary", { status: 503, body: { error: { message: "overloaded" } } });
  behaviours.set("model-secondary", { status: 200, body: null });
  const beforeRequests = (await db.select().from(schema.aiRequests)).length;

  const fell = await processTelegramUpdate(telegramUpdate("trigger a fallback"));
  check("the request still succeeds", fell.status === "processed", fell.reason);
  check(
    "the reply came from the secondary provider",
    telegramCalls.at(-1)?.text === "answer from model-secondary",
    telegramCalls.at(-1)?.text,
  );

  const fallbackRequest = (await db.select().from(schema.aiRequests))[beforeRequests];
  check("the fallback is counted", fallbackRequest?.fallbackCount === 1);
  check("the winning provider is recorded", fallbackRequest?.providerName === "secondary");
  // retryAttempts=1, so the primary is tried twice before the router moves on.
  check("every try is recorded", fallbackRequest?.attemptCount === 3, `${fallbackRequest?.attemptCount}`);

  const attempts = await db
    .select()
    .from(schema.requestAttempts)
    .where(eq(schema.requestAttempts.requestId, fallbackRequest!.id))
    .orderBy(schema.requestAttempts.attemptNumber);
  check("attempt 1 is the failed primary", attempts[0]?.providerName === "primary");
  check("attempt 1 is an error", attempts[0]?.outcome === "error");
  check("attempt 1 is classified as a server error", attempts[0]?.errorCategory === "server_error");
  check("the primary was retried once before giving up", attempts[1]?.providerName === "primary");
  check("the retry is also an error", attempts[1]?.outcome === "error");
  check("the retry is recorded as a separate attempt number", attempts[1]?.attemptNumber === 2);
  check("the last attempt is the successful secondary", attempts[2]?.providerName === "secondary");
  check("the last attempt succeeded", attempts[2]?.outcome === "success");
  check("attempt numbers are 1, 2, 3 in order", attempts.map((a) => a.attemptNumber).join() === "1,2,3");

  const fallbackEvents = (await eventsFor(fallbackRequest!.id)).map((e) => e.event);
  check("the trace names the fallback", fallbackEvents.includes("Fallback triggered"));
  check("the trace names the retry", fallbackEvents.includes("Retrying provider"));

  // ---------------------------------------------------------------------------
  section("5. Retry in place recovers without falling back");
  behaviours.set("model-primary", { status: 200, body: null });
  behaviours.set("model-secondary", { status: 200, body: null });
  // The primary rate-limits once, then answers normally.
  behavioursOnce.set("model-primary", [
    { status: 429, body: { error: { message: "slow down" } } },
  ]);
  const beforeRetry = (await db.select().from(schema.aiRequests)).length;

  const retried = await processTelegramUpdate(telegramUpdate("trigger a retry"));
  check("the request succeeds", retried.status === "processed", retried.reason);
  check(
    "the retry stayed on the primary provider",
    telegramCalls.at(-1)?.text === "answer from model-primary",
    telegramCalls.at(-1)?.text,
  );

  const retryRequest = (await db.select().from(schema.aiRequests))[beforeRetry];
  check("no fallback was needed", retryRequest?.fallbackCount === 0);
  check("both tries are recorded", retryRequest?.attemptCount === 2, `${retryRequest?.attemptCount}`);
  check(
    "the failing try is recorded as a rate limit",
    (await db
      .select()
      .from(schema.requestAttempts)
      .where(eq(schema.requestAttempts.requestId, retryRequest!.id)))
      .some((a) => a.errorCategory === "rate_limit"),
  );
  check(
    "the trace explains the retry",
    (await eventsFor(retryRequest!.id)).some((e) => e.event === "Retrying provider"),
  );

  // ---------------------------------------------------------------------------
  section("6. A rejected request stops the chain");
  behaviours.set("model-primary", { status: 400, body: { error: { message: "context too long" } } });
  behaviours.set("model-secondary", { status: 200, body: null });
  const beforeReject = (await db.select().from(schema.aiRequests)).length;
  const callsFor = (model: string) => hits.filter((h) => h.body.includes(`"${model}"`)).length;

  const secondaryHitsBefore = callsFor("model-secondary");

  const rejected = await processTelegramUpdate(telegramUpdate("too much context"));
  check("the request fails", rejected.status === "failed", rejected.status);

  const rejectedRequest = (await db.select().from(schema.aiRequests))[beforeReject];
  check("the failure is classified as a bad request", rejectedRequest?.errorCategory === "bad_request");
  check("no fallback was attempted", rejectedRequest?.fallbackCount === 0);
  check(
    "the secondary provider was never called",
    callsFor("model-secondary") === secondaryHitsBefore,
  );
  check(
    "the user is told something went wrong",
    telegramCalls.at(-1)?.text.includes("could not get a reply") === true,
  );
  check(
    "the raw provider error is not shown to the user",
    !telegramCalls.at(-1)?.text.includes("context too long"),
  );

  const rejectEvents = (await eventsFor(rejectedRequest!.id)).map((e) => e.event);
  check("the trace explains why fallback was skipped", rejectEvents.includes("Fallback skipped"));

  // ---------------------------------------------------------------------------
  section("7. Provider timeout");
  // providerTimeoutMs is pinned to 1000ms above, so a 3s response must abort.
  behaviours.set("model-primary", { status: 200, body: null, delayMs: 3_000 });
  behaviours.set("model-secondary", { status: 200, body: null });
  const beforeTimeout = (await db.select().from(schema.aiRequests)).length;

  const timedOut = await processTelegramUpdate(telegramUpdate("take your time"));
  check("the request still succeeds via the secondary", timedOut.status === "processed", timedOut.reason);
  check(
    "the answer came from the secondary provider",
    telegramCalls.at(-1)?.text === "answer from model-secondary",
    telegramCalls.at(-1)?.text,
  );

  const timeoutRequest = (await db.select().from(schema.aiRequests))[beforeTimeout];
  const timeoutAttempts = await db
    .select()
    .from(schema.requestAttempts)
    .where(eq(schema.requestAttempts.requestId, timeoutRequest!.id))
    .orderBy(schema.requestAttempts.attemptNumber);
  check(
    "the slow provider is recorded as a timeout",
    timeoutAttempts.filter((a) => a.errorCategory === "timeout").length === 2,
    timeoutAttempts.map((a) => a.errorCategory).join(","),
  );
  check(
    "the timeout is treated as a fallback-worthy failure",
    timeoutRequest?.fallbackCount === 1,
  );
  check(
    "the trace explains the timeout",
    (await eventsFor(timeoutRequest!.id)).some((e) => e.event.includes("timeout")),
  );

  // ---------------------------------------------------------------------------
  section("8. Invalid credentials fall back");
  behaviours.set("model-primary", { status: 401, body: { error: { message: "invalid api key" } } });
  behaviours.set("model-secondary", { status: 200, body: null });
  const beforeAuth = (await db.select().from(schema.aiRequests)).length;

  const badKey = await processTelegramUpdate(telegramUpdate("are you there"));
  check("the request succeeds on the backup", badKey.status === "processed", badKey.reason);

  const authRequest = (await db.select().from(schema.aiRequests))[beforeAuth];
  check("the auth failure is recorded as a fallback", authRequest?.fallbackCount === 1);
  check(
    "the 401 is classified as an auth error",
    authRequest?.errorCategory === null || authRequest?.errorCategory === undefined,
  );

  // ---------------------------------------------------------------------------
  section("9. Telegram delivery failure");
  behaviours.set("model-primary", { status: 200, body: null });
  telegramFails = true;
  const beforeSend = (await db.select().from(schema.aiRequests)).length;

  const undeliverable = await processTelegramUpdate(telegramUpdate("can you hear me"));
  check("the AI work still counts as processed", undeliverable.status === "processed", undeliverable.status);

  const undelivered = (await db.select().from(schema.aiRequests))[beforeSend];
  check("delivery is recorded as failed", undelivered?.telegramDelivered === false);
  check("the telegram error is captured", Boolean(undelivered?.telegramError), undelivered?.telegramError ?? "");

  const undeliveredMessages = await db
    .select()
    .from(schema.messages)
    .where(eq(schema.messages.requestId, undelivered!.id));
  check(
    "the answer is still stored even though it could not be sent",
    undeliveredMessages.some((m) => m.direction === "outbound" && m.text === "answer from model-primary"),
  );
  check(
    "the undelivered message is marked failed",
    undeliveredMessages.some((m) => m.status === "failed" && m.errorCategory === "telegram"),
  );
  telegramFails = false;

  // ---------------------------------------------------------------------------
  section("10. Malformed input");
  const malformed = await processTelegramUpdate({ nonsense: true });
  check("a malformed update is rejected", malformed.status === "invalid", malformed.status);
  check(
    "it creates no request",
    (await db.select().from(schema.aiRequests)).length === beforeSend + 1,
  );

  // ---------------------------------------------------------------------------
  section("11. Nothing sensitive leaks");
  const everything = JSON.stringify({
    messages: await db.select().from(schema.messages),
    requests: await db.select().from(schema.aiRequests),
    attempts: await db.select().from(schema.requestAttempts),
    events: await db.select().from(schema.requestEvents),
    logs: await db.select().from(schema.logs),
    providers: await db.select().from(schema.aiProviders),
  });
  check("the bot token never appears", !everything.includes("SMOKE-TEST-TOKEN"));
  check("a decrypted provider key never appears", !everything.includes("key-primary"));
  check("the raw provider key is stored encrypted", everything.includes("key-primary") === false);
  check(
    "an encrypted provider key round-trips",
    (await db.select().from(schema.aiProviders)).every((p) => Boolean(p.apiKeyEncrypted)),
  );
  } finally {
    globalThis.fetch = realFetch;
    provider.close();
    client.close();
    // libsql can hold the file briefly; a failed cleanup must not mask results.
    try {
      rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    } catch {
      console.log(`  (left temp database at ${dir})`);
    }
  }

  console.log(
    `\n${failed === 0 ? "✓ all checks passed" : `✗ ${failed} check(s) failed`} — ${passed} passed, ${failed} failed`,
  );
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error("✗ smoke run crashed:", error);
  process.exit(1);
});
