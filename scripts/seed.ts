import { config } from "dotenv";
config({ path: ".env.local", quiet: true });
const { pool } = await import("../lib/db");
const { signalKeys: keys } = await import("../lib/contracts/signals");
try {
  await pool.query(
    "INSERT INTO slop_signals(key) SELECT unnest($1::text[]) ON CONFLICT(key) DO NOTHING",
    [keys],
  );
  console.log(
    `${keys.length} canonical signals seeded without changing existing IDs.`,
  );
} finally {
  await pool.end();
}
