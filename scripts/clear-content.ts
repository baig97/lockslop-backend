import { config } from "dotenv";
config({ path: ".env.local", quiet: true });
if (!process.argv.includes("--confirm"))
  throw Error(
    "Pass --confirm to clear content and cached data from the configured database.",
  );
const { pool } = await import("../lib/db");
const client = await pool.connect();
try {
  await client.query("BEGIN");
  const before = (
    await client.query("SELECT id,key FROM slop_signals ORDER BY key")
  ).rows;
  const counts: Record<string, number | null> = {};
  // Explicit tables: preserve signal identities and all auth/client configuration.
  for (const table of [
    "content_reports",
    "content_vote_signals",
    "content_vote_feedback",
    "content_votes",
    "ai_content_signals",
    "content_payloads",
    "entities",
    "auth.api_rate_limits",
  ])
    counts[table] = (await client.query(`DELETE FROM ${table}`)).rowCount;
  const after = (
    await client.query("SELECT id,key FROM slop_signals ORDER BY key")
  ).rows;
  if (JSON.stringify(before) !== JSON.stringify(after))
    throw Error("Signal definitions changed");
  await client.query("COMMIT");
  console.log(
    JSON.stringify({
      cleared: counts,
      preservedSignalTypes: after.length,
      authPreserved: true,
    }),
  );
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  client.release();
  await pool.end();
}
