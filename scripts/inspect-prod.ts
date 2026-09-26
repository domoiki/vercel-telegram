/**
 * One-off diagnostic: what does the production database actually contain?
 * Reads the Turso database using the same environment variables the app uses.
 */
import { createClient } from "@libsql/client";

async function main() {
  const url = process.env.TURSO_DATABASE_URL;
  const authToken = process.env.TURSO_AUTH_TOKEN;
  if (!url || !authToken) {
    console.error("Set TURSO_DATABASE_URL and TURSO_AUTH_TOKEN first.");
    process.exit(1);
  }
  const db = createClient({ url, authToken });

  const tg = await db.execute(
    "select chat_id_1, chat_id_2, chat_id_3, bot_username, webhook_url, bot_token_encrypted is not null as has_token from telegram_config",
  );
  const cfg = tg.rows[0] as Record<string, unknown> | undefined;
  console.log("--- telegram_config ---");
  console.log("  bot token tersimpan :", cfg?.has_token === 1 ? "YA" : "TIDAK");
  console.log("  chat_id_1           :", String(cfg?.chat_id_1 ?? "(kosong)"));
  console.log("  chat_id_2           :", String(cfg?.chat_id_2 ?? "(kosong)"));
  console.log("  chat_id_3           :", String(cfg?.chat_id_3 ?? "(kosong)"));
  console.log("  bot username        :", String(cfg?.bot_username ?? "(kosong)"));
  console.log("  webhook_url         :", String(cfg?.webhook_url ?? "(kosong)"));

  const prov = await db.execute(
    "select name, adapter, model, base_url, enabled, is_primary, priority, last_tested_at, last_test_ok, last_test_http_status, last_test_error from ai_providers order by priority",
  );
  console.log(`\n--- ai_providers (${prov.rows.length}) ---`);
  for (const r of prov.rows) {
    const p = r as Record<string, unknown>;
    console.log(`  [p${String(p.priority)}] ${String(p.name)}`);
    console.log(`      adapter=${String(p.adapter)}  model=${String(p.model)}`);
    console.log(`      base=${String(p.base_url)}`);
    console.log(`      enabled=${String(p.enabled)}  primary=${String(p.is_primary)}`);
    console.log(
      `      test: ${p.last_tested_at ? String(p.last_tested_at) : "belum pernah"} ok=${String(p.last_test_ok ?? "?")} http=${String(p.last_test_http_status ?? "-")} err=${String(p.last_test_error ?? "-")}`,
    );
  }

  const upd = await db.execute("select count(*) as n from telegram_updates");
  console.log(`\n--- telegram_updates: ${String((upd.rows[0] as Record<string, unknown>).n)} update diterima`);

  const reqs = await db.execute(
    "select count(*) as n from ai_requests",
  );
  console.log(`--- ai_requests: ${String((reqs.rows[0] as Record<string, unknown>).n)} request AI`);

  const attempts = await db.execute(
    "select provider_name, model, attempt_number, http_status, outcome, error_category, error_message, started_at from request_attempts order by started_at desc limit 8",
  );
  console.log(`\n--- 8 percobaan terakhir ---`);
  for (const r of attempts.rows) {
    const a = r as Record<string, unknown>;
    console.log(
      `  #${String(a.attempt_number)} ${String(a.provider_name)} http=${String(a.http_status ?? "-")} ${String(a.outcome)} ${String(a.error_category ?? "")}`,
    );
    console.log(`      ${String(a.error_message ?? "").slice(0, 300)}`);
  }

  const logs = await db.execute(
    "select level, category, message, created_at from logs order by created_at desc limit 10",
  );
  console.log("\n--- 10 log terakhir ---");
  for (const r of logs.rows) {
    const l = r as Record<string, unknown>;
    console.log(`  ${String(l.level).padEnd(5)} ${String(l.category).padEnd(10)} ${String(l.message).slice(0, 300)}`);
  }
}

main().catch((error: unknown) => {
  console.error("GAGAL:", error instanceof Error ? error.message : String(error));
  process.exit(1);
});
