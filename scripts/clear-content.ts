import { config } from "dotenv";
config({ path: ".env.local", quiet: true });
if (!process.argv.includes("--confirm"))
  throw Error("Pass --confirm to clear development content.");
const { pool } = await import("../lib/db");
const c = await pool.connect();
async function snapshot() {
  const tables = (
    await c.query(
      "SELECT table_name FROM information_schema.tables WHERE table_schema='auth' AND table_type='BASE TABLE' AND table_name<>'api_rate_limits' ORDER BY table_name",
    )
  ).rows;
  const values = [];
  for (const { table_name } of tables) {
    if (!/^[a-z_]+$/.test(table_name)) throw Error("Unexpected auth table");
    values.push({
      table: table_name,
      ...(
        await c.query(
          `SELECT count(*)::int AS count,md5(COALESCE(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text)::text,'')) AS digest FROM auth."${table_name}" t`,
        )
      ).rows[0],
    });
  }
  return {
    auth: values,
    signals: (await c.query("SELECT id,key FROM slop_signals ORDER BY key"))
      .rows,
  };
}
try {
  await c.query("BEGIN");
  const before = await snapshot(),
    counts: Record<string, number | null> = {};
  for (const table of [
    "content_reports",
    "content_vote_signals",
    "content_vote_feedback",
    "content_votes",
    "ai_content_signals",
    "content_analyses",
    "content_payloads",
    "entities",
    "auth.api_rate_limits",
  ]) {
    if ((await c.query("SELECT to_regclass($1) AS name", [table])).rows[0].name)
      counts[table] = (await c.query(`DELETE FROM ${table}`)).rowCount;
  }
  if (JSON.stringify(before) !== JSON.stringify(await snapshot()))
    throw Error("Auth or signal records changed");
  await c.query("COMMIT");
  console.log(
    JSON.stringify({ cleared: counts, authAndSignalRecordsPreserved: true }),
  );
} catch (e) {
  await c.query("ROLLBACK");
  throw e;
} finally {
  c.release();
  await pool.end();
}
