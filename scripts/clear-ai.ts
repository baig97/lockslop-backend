import { config } from "dotenv";
config({ path: ".env.local", quiet: true });
if (!process.argv.includes("--confirm"))
  throw Error(
    "Pass --confirm to delete all derived AI scores from the configured database.",
  );
const { pool } = await import("../lib/db");
try {
  const result = await pool.query("DELETE FROM ai_content_signals");
  console.log(
    `Deleted ${result.rowCount} derived scores; payloads and contributions retained.`,
  );
} finally {
  await pool.end();
}
