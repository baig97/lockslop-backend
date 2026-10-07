import { config } from "dotenv";
config({ path: ".env.local", quiet: true });
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
const { ensureAiSignals, lookupAiSignals, generationPool } =
  await import("../lib/ai-signals");
const { pool } = await import("../lib/db");
const { hashContent, sanitizeContent } =
  await import("../lib/contracts/content");
const { fixtureContent, evaluationFixtures } =
  await import("./evaluation-fixtures");
const { aiSignalKeys } = await import("../lib/contracts/overview");
const { postgresAnalysisStore } = await import("../lib/ai-signals");
const user = randomUUID(),
  second = randomUUID(),
  entities: string[] = [];
let calls = 0;
const derive = async () => {
  calls++;
  await new Promise((r) => setTimeout(r, 50));
  return aiSignalKeys.map((key) => ({ key, score: 0.25 }));
};
const deps = { store: postgresAnalysisStore, derive, limit: async () => {} };
async function entity(type = "youtube_video") {
  const externalId = randomUUID();
  const id = (
    await pool.query(
      "INSERT INTO entities(entity_type,external_id) VALUES($1,$2) RETURNING id",
      [type, externalId],
    )
  ).rows[0].id;
  entities.push(id);
  return id;
}
try {
  for (const id of [user, second])
    await pool.query(
      "INSERT INTO auth.user(id,name,email) VALUES($1,'Test',$2)",
      [id, id + "@example.invalid"],
    );
  const id = await entity(),
    input = sanitizeContent(
      "youtube_video",
      fixtureContent(evaluationFixtures[0]),
    ),
    hash = hashContent("youtube_video", input);
  assert.equal((await lookupAiSignals(id, hash)).status, "needs_input");
  const results = await Promise.all(
    Array.from({ length: 4 }, () =>
      ensureAiSignals(id, "youtube_video", hash, input, user, deps),
    ),
  );
  assert(results.every((r) => r.status === "ready"));
  assert.equal(calls, 1);
  const altered = structuredClone(input);
  altered.comments = {
    status: "available",
    items: [{ text: "Invented accusation" }],
  };
  await ensureAiSignals(id, "youtube_video", hash, altered, second, deps);
  assert.equal(calls, 1);
  let saved = (
    await pool.query("SELECT * FROM content_analyses WHERE entity_id=$1", [id])
  ).rows[0];
  assert.equal(saved.user_id, user);
  assert.deepEqual(saved.input, input);
  const changed = structuredClone(input);
  changed.description += " A revised explanation.";
  const hash2 = hashContent("youtube_video", changed);
  await ensureAiSignals(id, "youtube_video", hash2, changed, user, deps);
  assert.equal(calls, 2);
  assert.equal(
    (
      await pool.query(
        "SELECT count(*)::int AS n FROM content_analyses WHERE entity_id=$1",
        [id],
      )
    ).rows[0].n,
    2,
  );
  await assert.rejects(
    ensureAiSignals(id, "youtube_video", hash, changed, user, deps),
    /hash mismatch/,
  );
  await pool.query(
    "UPDATE content_analyses SET expires_at=now()-interval '1 second' WHERE entity_id=$1 AND content_hash=$2",
    [id, hash],
  );
  assert.equal((await lookupAiSignals(id, hash)).status, "needs_input");
  await ensureAiSignals(id, "youtube_video", hash, altered, second, deps);
  assert.equal(calls, 3);
  saved = (
    await pool.query(
      "SELECT * FROM content_analyses WHERE entity_id=$1 AND content_hash=$2",
      [id, hash],
    )
  ).rows[0];
  assert.equal(saved.user_id, second);
  assert.deepEqual(saved.input, altered);
  const nonEnglish = sanitizeContent(
    "youtube_video",
    fixtureContent(evaluationFixtures[6]),
  );
  const h = hashContent("youtube_video", nonEnglish);
  assert.equal(
    (await ensureAiSignals(id, "youtube_video", h, nonEnglish, user, deps))
      .status,
    "unsupported_language",
  );
  assert.equal(calls, 3);
  assert.equal((await lookupAiSignals(id, h)).status, "unsupported_language");
  const failure = await entity();
  const bad = {
    ...deps,
    derive: async () => [{ key: "repetitive" as const, score: 2 }],
  };
  assert.equal(
    (await ensureAiSignals(failure, "youtube_video", hash, input, user, bad))
      .status,
    "unavailable",
  );
  assert.equal(
    (
      await pool.query(
        "SELECT count(*)::int AS n FROM ai_content_signals s JOIN content_analyses a ON a.id=s.analysis_id WHERE a.entity_id=$1",
        [failure],
      )
    ).rows[0].n,
    0,
  );
  saved = (
    await pool.query("SELECT * FROM content_analyses WHERE entity_id=$1", [
      failure,
    ])
  ).rows[0];
  assert.equal(saved.status, "failed");
  assert.deepEqual(saved.input, input);
  await pool.query(
    "UPDATE content_analyses SET updated_at=now()-interval '20 seconds' WHERE entity_id=$1",
    [failure],
  );
  assert.equal(
    (
      await ensureAiSignals(
        failure,
        "youtube_video",
        hash,
        altered,
        second,
        deps,
      )
    ).status,
    "ready",
  );
  saved = (
    await pool.query("SELECT * FROM content_analyses WHERE entity_id=$1", [
      failure,
    ])
  ).rows[0];
  assert.equal(saved.user_id, user);
  assert.deepEqual(saved.input, input);
  // Force a mid-publication constraint failure to verify actual SQL rollback.
  const atomic = await entity();
  const lease = await postgresAnalysisStore.lock(atomic, hash);
  assert(lease);
  try {
    const claimed = await lease.claim(input, user);
    await assert.rejects(
      lease.save({
        status: "ready",
        generatedAt: new Date().toISOString(),
        signals: aiSignalKeys.map((key, index) => ({
          key,
          score: index === 2 ? 2 : 0.5,
        })),
      }),
    );
    assert.equal(
      (
        await pool.query(
          "SELECT count(*)::int AS n FROM ai_content_signals WHERE analysis_id=$1",
          [claimed.id],
        )
      ).rows[0].n,
      0,
    );
    assert.equal(
      (
        await pool.query("SELECT status FROM content_analyses WHERE id=$1", [
          claimed.id,
        ])
      ).rows[0].status,
      "pending",
    );
  } finally {
    await lease.release();
  }
  // Database constraints and retention cascade.
  await assert.rejects(
    pool.query(
      "UPDATE content_analyses SET status='unsupported_language',detected_language=NULL WHERE id=$1",
      [saved.id],
    ),
  );
  await assert.rejects(
    pool.query("INSERT INTO entities(entity_type) VALUES('linkedin_post')"),
  );
  await assert.rejects(
    pool.query(
      "INSERT INTO entities(entity_type,external_id,canonical_url) VALUES('linkedin_post','x','https://example.test')",
    ),
  );
  assert.equal(
    (await pool.query("SELECT to_regclass('content_payloads') AS table"))
      .rows[0].table,
    null,
  );
  await assert.rejects(
    pool.query(
      "INSERT INTO ai_content_signals(analysis_id,signal_key,score) VALUES($1,'repetitive',1.1)",
      [saved.id],
    ),
  );
  await pool.query(
    "UPDATE content_analyses SET expires_at=now()-interval '1 second' WHERE entity_id=$1",
    [failure],
  );
  await pool.query(
    "DELETE FROM content_analyses WHERE entity_id=$1 AND expires_at<=now()",
    [failure],
  );
  assert.equal(
    (
      await pool.query(
        "SELECT count(*)::int AS n FROM ai_content_signals WHERE analysis_id=$1",
        [saved.id],
      )
    ).rows[0].n,
    0,
  );
  console.log(
    "PASS: real database cold/warm/expired/multi-hash caches, same-hash concurrency, first input attribution, language outcomes, atomic failures/retry, XOR constraints and retention cascade. No platform or Jev requests.",
  );
} finally {
  await pool.query("DELETE FROM entities WHERE id=ANY($1::uuid[])", [entities]);
  await pool.query("DELETE FROM auth.user WHERE id=ANY($1::uuid[])", [
    [user, second],
  ]);
  await generationPool.end();
  await pool.end();
}
