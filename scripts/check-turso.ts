/**
 * One-off connectivity check for the production Turso database.
 * Run with TURSO_DATABASE_URL and TURSO_AUTH_TOKEN set in the environment.
 */
import { createClient } from "@libsql/client";

const url = process.env.TURSO_DATABASE_URL;
const authToken = process.env.TURSO_AUTH_TOKEN;

async function main() {
  const client = createClient({ url, authToken });

  const ping = await client.execute("select 1 as ok");
  console.log("  terhubung:", ping.rows[0]?.ok === 1 ? "YA" : "TIDAK");

  const tables = await client.execute(
    "select name from sqlite_master where type = 'table' order by name",
  );
  console.log("  tabel:", tables.rows.map((r) => r.name).join(", ") || "(kosong)");

  // Prove a write works with this token, then clean up after ourselves.
  await client.execute("create table if not exists _deploy_probe (id integer primary key)");
  await client.execute("insert into _deploy_probe (id) values (1)");
  await client.execute("drop table _deploy_probe");
  console.log("  hak tulis: OK");

  const groups = await client.execute("select count(*) as c from sqlite_master");
  console.log("  objek total:", groups.rows[0]?.c);
}

main().catch((error) => {
  console.error("  GAGAL:", error instanceof Error ? error.message : String(error));
  process.exit(1);
});
