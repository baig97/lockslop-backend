import { config } from "dotenv";
config({ path: ".env.local", quiet: true });
if (!process.argv.includes("--confirm"))
  throw Error("Pass --confirm to clear development analyses.");
const { pool } = await import("../lib/db");
try {
  console.log(
    JSON.stringify({
      deleted: (await pool.query("DELETE FROM content_analyses")).rowCount,
    }),
  );
} finally {
  await pool.end();
}
