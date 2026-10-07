import { config } from "dotenv";
config({ path: ".env.local", quiet: true });
const { pool } = await import("../lib/db");
try {
  const result = await pool.query(
    "DELETE FROM content_analyses WHERE expires_at<=now()",
  );
  console.log(JSON.stringify({ expiredAnalysesDeleted: result.rowCount }));
} finally {
  await pool.end();
}
