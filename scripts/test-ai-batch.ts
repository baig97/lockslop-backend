import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { config } from "dotenv";
config({ path: ".env.local", quiet: true });
const { ensureAiSignalsBatch, analysisKey } = await import("../lib/ai-batch");
const { generationPool } = await import("../lib/ai-signals");
const { pool } = await import("../lib/db");
const { sanitizeContent, hashContent } =
  await import("../lib/contracts/content");
const { signalsFor } = await import("../lib/contracts/signals");
const { generatorVersion } = await import("../lib/ai/config");
const { evaluationFixtures, fixtureContent } =
  await import("./evaluation-fixtures");
import type { Analysis } from "../lib/ai-signals";
import type {
  BatchAnalysisStore,
  AnalysisRef,
  AnalysisInput,
  AnalysisCompletion,
} from "../lib/ai-batch";
class MemoryBatchStore implements BatchAnalysisStore {
  rows = new Map<string, Analysis>();
  loads = 0;
  claims = 0;
  saves = 0;
  releases = 0;
  failures = 0;
  failSave = false;
  busy = new Set<string>();
  async load(refs: AnalysisRef[]) {
    this.loads++;
    return new Map(
      refs.flatMap((r) =>
        this.rows.has(analysisKey(r))
          ? [[analysisKey(r), this.rows.get(analysisKey(r))!] as const]
          : [],
      ),
    );
  }
  async lock(refs: AnalysisRef[]) {
    return {
      locked: new Set(
        refs.map(analysisKey).filter((key) => !this.busy.has(key)),
      ),
      load: (refs: AnalysisRef[]) => this.load(refs),
      claim: async (items: AnalysisInput[], userId: string) => {
        this.claims++;
        for (const item of items) {
          const key = analysisKey(item),
            old = this.rows.get(key);
          if (!old || old.expiresAt.getTime() <= Date.now())
            this.rows.set(key, {
              id: randomUUID(),
              entityId: item.entityId,
              contentHash: item.hash,
              userId,
              input: structuredClone(item.input),
              status: "pending",
              generatorVersion: generatorVersion(item.type),
              detectedLanguage: null,
              generatedAt: null,
              expiresAt: new Date(Date.now() + 86400000),
              updatedAt: new Date(),
              signals: [],
            });
          this.rows.get(key)!.status = "pending";
        }
        return new Map(
          items.map((item) => [
            analysisKey(item),
            this.rows.get(analysisKey(item))!,
          ]),
        );
      },
      save: async (completions: AnalysisCompletion[]) => {
        this.saves++;
        if (this.failSave) throw Error("Database unavailable");
        for (const c of completions) {
          c.analysis.status = c.result?.status ?? "failed";
          c.analysis.updatedAt = new Date();
          c.analysis.generatorVersion = generatorVersion(c.type);
          c.analysis.signals =
            c.result?.status === "ready" ? c.result.signals : [];
          c.analysis.generatedAt = c.result ? new Date() : null;
          c.analysis.detectedLanguage =
            c.result?.status === "unsupported_language"
              ? c.result.detectedLanguage
              : null;
        }
      },
      fail: async (ids: string[]) => {
        this.failures++;
        for (const a of this.rows.values())
          if (ids.includes(a.id)) a.status = "failed";
      },
      release: async () => {
        this.releases++;
      },
    };
  }
}
try {
  const base = sanitizeContent(
    "youtube_video",
    fixtureContent(evaluationFixtures[0]),
  );
  const items: AnalysisInput[] = Array.from({ length: 10 }, (_, i) => ({
    entityId: `item-${i}`,
    type: "youtube_video",
    input: base,
    hash: hashContent("youtube_video", base),
  }));
  const store = new MemoryBatchStore();
  let active = 0,
    maxActive = 0,
    calls = 0;
  const deps = {
    store,
    limit: async (_u: string, n: number) => n,
    derive: async (type: AnalysisRef["type"]) => {
      calls++;
      active++;
      maxActive = Math.max(active, maxActive);
      assert.equal(
        store.saves,
        0,
        "No result writes while evaluations are still running",
      );
      await new Promise((r) => setTimeout(r, 10));
      active--;
      return signalsFor(type).map((key) => ({ key, score: 0.5 }));
    },
  };
  const result = await ensureAiSignalsBatch(
    [...items, items[0]],
    "first",
    deps,
  );
  assert.equal(calls, 10);
  assert.equal(maxActive, 10);
  assert.equal(store.claims, 1);
  assert.equal(store.saves, 1);
  assert.equal(store.releases, 1);
  assert.equal(store.loads, 2);
  assert(result.every((r) => "ai" in r && r.ai.status === "ready"));
  await ensureAiSignalsBatch(items, "other", deps);
  assert.equal(calls, 10);
  assert.equal(store.claims, 1);
  assert.equal(store.saves, 1);
  assert.equal(store.rows.get(analysisKey(items[0]))!.userId, "first");
  const mixed = new MemoryBatchStore();
  let mixedCalls = 0;
  const spanish = sanitizeContent(
    "youtube_video",
    fixtureContent(evaluationFixtures[6]),
  );
  const post = sanitizeContent("linkedin_post", {
    schemaVersion: 2,
    text: base.description,
    publishedAt: null,
  });
  const mixedItems: AnalysisInput[] = [
    items[0],
    {
      ...items[1],
      input: spanish,
      hash: hashContent("youtube_video", spanish),
    },
    {
      ...items[2],
      type: "linkedin_post",
      input: post,
      hash: hashContent("linkedin_post", post),
    },
  ];
  const outcomes = await ensureAiSignalsBatch(mixedItems, "u", {
    store: mixed,
    limit: deps.limit,
    derive: async (type) => {
      mixedCalls++;
      if (type === "youtube_video") throw Error("Provider failed");
      return signalsFor(type).map((key) => ({ key, score: 0.5 }));
    },
  });
  assert.deepEqual(
    outcomes.map((o) => ("ai" in o ? o.ai.status : "error")),
    ["unavailable", "unsupported_language", "ready"],
  );
  assert.equal(mixedCalls, 2);
  assert.equal(mixed.saves, 1);
  await ensureAiSignalsBatch([mixedItems[0]], "u", { ...deps, store: mixed });
  assert.equal(mixed.claims, 1, "Failed analyses respect retry cooldown");
  const failureStore = new MemoryBatchStore();
  failureStore.failSave = true;
  const failed = await ensureAiSignalsBatch([items[0]], "u", {
    ...deps,
    store: failureStore,
    derive: async () =>
      signalsFor("youtube_video").map((key) => ({ key, score: 0.5 })),
  });
  assert("ai" in failed[0] && failed[0].ai.status === "unavailable");
  assert.equal(failureStore.failures, 1);
  assert.equal(failureStore.releases, 1);
  const limited = new MemoryBatchStore();
  const limitResults = await ensureAiSignalsBatch(items.slice(0, 3), "u", {
    ...deps,
    store: limited,
    limit: async () => 1,
    derive: async () =>
      signalsFor("youtube_video").map((key) => ({ key, score: 0.5 })),
  });
  assert("ai" in limitResults[0] && limitResults[0].ai.status === "ready");
  assert(
    limitResults
      .slice(1)
      .every(
        (o) => "error" in o && (o.error as { status: number }).status === 429,
      ),
  );
  assert.equal(limited.rows.size, 1);
  const busy = new MemoryBatchStore();
  busy.busy.add(analysisKey(items[0]));
  const busyResults = await ensureAiSignalsBatch([items[0]], "u", {
    ...deps,
    store: busy,
  });
  assert("ai" in busyResults[0] && busyResults[0].ai.status === "unavailable");
  assert.equal(busy.claims, 0);
  assert.equal(busy.releases, 1);
  console.log(
    "PASS: batch reads/claims/writes, ten concurrent evaluations, duplicate coalescing, cache reuse, first attribution, isolated provider failure, language gating, cooldown, rate limits, unavailable locks and persistence failure cleanup.",
  );
} finally {
  await generationPool.end();
  await pool.end();
}
