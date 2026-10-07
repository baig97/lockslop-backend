import { config } from "dotenv";
config({ path: ".env.local", quiet: true });
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
const { pool } = await import("../lib/db");
const { ensureAiSignals, lookupAiSignals, generationPool } =
  await import("../lib/ai-signals");
const { fixtureContent, evaluationFixtures } =
  await import("./evaluation-fixtures");
const { hashContent, sanitizeContent } =
  await import("../lib/contracts/content");
assert(process.env.TYPESAFE_API_KEY, "Set TYPESAFE_API_KEY");
const user = randomUUID();
let entity: string | undefined;
try {
  await pool.query(
    "INSERT INTO auth.user(id,name,email) VALUES($1,'Smoke',$2)",
    [user, user + "@example.invalid"],
  );
  entity = (
    await pool.query(
      "INSERT INTO entities(entity_type,external_id) VALUES('youtube_video',$1) RETURNING id",
      [randomUUID()],
    )
  ).rows[0].id;
  const input = sanitizeContent(
    "youtube_video",
    fixtureContent(evaluationFixtures[0]),
  );
  const hash = hashContent("youtube_video", input);
  const result = await ensureAiSignals(
    entity!,
    "youtube_video",
    hash,
    input,
    user,
  );
  assert.equal(result.status, "ready");
  assert.deepEqual(await lookupAiSignals(entity!, hash), result);
  console.log(
    "PASS: live Jev five-score result, database persistence and hash-cache reuse; no platform fetch.",
  );
} finally {
  if (entity) await pool.query("DELETE FROM entities WHERE id=$1", [entity]);
  await pool.query("DELETE FROM auth.user WHERE id=$1", [user]);
  await generationPool.end();
  await pool.end();
}
