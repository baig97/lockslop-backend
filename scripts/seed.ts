import { config } from "dotenv";
config({ path: ".env.local", quiet: true });
const { pool } = await import("../lib/db");
const keys = [
  "repetitive",
  "clickbait",
  "low_information_density",
  "ai_generated_filler",
  "copied_or_repackaged",
];
try {
  await pool.query(
    "INSERT INTO slop_signals(key) SELECT unnest($1::text[]) ON CONFLICT(key) DO NOTHING",
    [keys],
  );
  console.log("Five stable signals seeded.");
} finally {
  await pool.end();
}
