import { config } from "dotenv";
config({ path: ".env.local", quiet: true });
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { Analysis, AnalysisStore, AnalysisLease } from "../lib/ai-signals";
const { ensureAiSignals, lookupAiSignals, cachedResult, generationPool } =
  await import("../lib/ai-signals");
const { pool } = await import("../lib/db");
const { sanitizeContent, hashContent } =
  await import("../lib/contracts/content");
const { signalsFor } = await import("../lib/contracts/signals");
const { generatorVersion } = await import("../lib/ai/config");
const { fixtureContent, evaluationFixtures } =
  await import("./evaluation-fixtures");
class MemoryStore implements AnalysisStore {
  rows = new Map<string, Analysis>();
  locks = new Set<string>();
  async load(id: string, hash: string) {
    return this.rows.get(id + hash) ?? null;
  }
  async lock(id: string, hash: string): Promise<AnalysisLease> {
    const key = id + hash;
    while (this.locks.has(key)) await new Promise((r) => setTimeout(r, 1));
    this.locks.add(key);
    let row: Analysis;
    return {
      load: () => this.load(id, hash),
      claim: async (input, userId) => {
        const previous = this.rows.get(key);
        row =
          previous && previous.expiresAt.getTime() > Date.now()
            ? previous
            : {
                id: randomUUID(),
                entityId: id,
                contentHash: hash,
                userId,
                input: structuredClone(input),
                status: "pending",
                generatorVersion: generatorVersion(
                  "title" in input ? "youtube_video" : "linkedin_post",
                ),
                detectedLanguage: null,
                generatedAt: null,
                expiresAt: new Date(Date.now() + 86400000),
                updatedAt: new Date(),
                signals: [],
              };
        this.rows.set(key, row);
        return row;
      },
      fail: async () => {
        row.status = "failed";
        row.updatedAt = new Date();
      },
      save: async (result) => {
        row.status = result.status;
        row.generatorVersion = generatorVersion(
          "title" in row.input ? "youtube_video" : "linkedin_post",
        );
        row.generatedAt = new Date();
        row.signals = result.status === "ready" ? result.signals : [];
        row.detectedLanguage =
          result.status === "unsupported_language"
            ? result.detectedLanguage
            : null;
      },
      release: async () => {
        this.locks.delete(key);
      },
    };
  }
}
try {
  const store = new MemoryStore();
  let calls = 0,
    active = 0,
    maxActive = 0;
  const deps = {
    store,
    limit: async () => {},
    derive: async (type: "youtube_video" | "linkedin_post") => {
      calls++;
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise((r) => setTimeout(r, 5));
      active--;
      return signalsFor(type).map((key) => ({ key, score: 0.5 }));
    },
  };
  const input = sanitizeContent(
      "youtube_video",
      fixtureContent(evaluationFixtures[0]),
    ),
    hash = hashContent("youtube_video", input);
  assert.equal((await lookupAiSignals("e", hash, store)).status, "needs_input");
  assert.equal(calls, 0);
  await Promise.all(
    Array.from({ length: 5 }, () =>
      ensureAiSignals("e", "youtube_video", hash, input, "u", deps),
    ),
  );
  assert.equal(calls, 1);
  const changed = structuredClone(input);
  changed.counts.comments = 200;
  await ensureAiSignals("e", "youtube_video", hash, changed, "other", deps);
  assert.equal(calls, 1);
  assert.deepEqual(store.rows.get("e" + hash)?.input, input);
  assert.equal(store.rows.get("e" + hash)?.userId, "u");
  const revision = structuredClone(input);
  revision.description += " revised";
  const second = hashContent("youtube_video", revision);
  await Promise.all([
    ensureAiSignals("a", "youtube_video", hash, input, "u", deps),
    ensureAiSignals("a", "youtube_video", second, revision, "u", deps),
  ]);
  assert.equal(maxActive, 2);
  const expired = store.rows.get("e" + hash)!;
  expired.expiresAt = new Date(0);
  assert.equal(cachedResult(expired).status, "needs_input");
  await ensureAiSignals("e", "youtube_video", hash, changed, "other", deps);
  assert.equal(store.rows.get("e" + hash)?.userId, "other");
  await assert.rejects(
    ensureAiSignals("e", "youtube_video", hash, revision, "u", deps),
    /hash mismatch/,
  );
  const fail = {
    ...deps,
    derive: async () => [{ key: "repetitive" as const, score: 1 }],
  };
  assert.equal(
    (await ensureAiSignals("bad", "youtube_video", hash, input, "u", fail))
      .status,
    "unavailable",
  );
  assert.equal(store.rows.get("bad" + hash)?.signals.length, 0);
  assert.equal(store.rows.get("bad" + hash)?.status, "failed");
  const row = store.rows.get("bad" + hash)!;
  row.updatedAt = new Date(0);
  await ensureAiSignals("bad", "youtube_video", hash, changed, "other", deps);
  assert.deepEqual(row.input, input);
  assert.equal(row.userId, "u");
  const spanish = sanitizeContent(
    "youtube_video",
    fixtureContent(evaluationFixtures[6]),
  );
  const prior = calls;
  await ensureAiSignals(
    "language",
    "youtube_video",
    hashContent("youtube_video", spanish),
    spanish,
    "u",
    deps,
  );
  assert.equal(calls, prior);
  const post = sanitizeContent("linkedin_post", {
    schemaVersion: 2,
    text: input.description,
    publishedAt: input.publishedAt,
  });
  const ph = hashContent("linkedin_post", post);
  assert.equal(
    (await ensureAiSignals("post", "linkedin_post", ph, post, "u", deps))
      .status,
    "ready",
  );
  const oldPost = store.rows.get("post" + ph)!;
  const retained = structuredClone(oldPost.input),
    firstUser = oldPost.userId;
  oldPost.generatorVersion = "platform-content-v2:jev-1.13.0";
  oldPost.signals = oldPost.signals.slice(0, 5);
  assert.equal(cachedResult(oldPost).status, "needs_input");
  const beforeRegeneration = calls;
  await ensureAiSignals(
    "post",
    "linkedin_post",
    ph,
    { ...post, counts: { comments: 5, reactions: 3, reposts: 2 } },
    "new-user",
    deps,
  );
  assert.equal(calls, beforeRegeneration + 1);
  assert.equal(cachedResult(oldPost).status, "ready");
  assert.equal(oldPost.signals.length, 7);
  assert.deepEqual(oldPost.input, retained);
  assert.equal(oldPost.userId, firstUser);
  console.log(
    "PASS: cache-only lookup, first-input reuse, simultaneous hash isolation, same-hash deduplication, expiry, validation, atomic failure/retry and language gating with injected in-memory repository.",
  );
} finally {
  await generationPool.end();
  await pool.end();
}
