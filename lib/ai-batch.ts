import type { PoolClient } from "pg";
import { pool } from "./db";
import {
  cachedResult,
  deriveAiSignals,
  generationPool,
  type Analysis,
} from "./ai-signals";
import {
  sanitizeContent,
  hashContent,
  type DerivedContent,
} from "./contracts/content";
import { completeSignalSet, type SignalEntityType } from "./contracts/signals";
import { aiResultSchema, type AiResult } from "./contracts/overview";
import { generatorVersion } from "./ai/config";
import { checkContentLanguage } from "./ai/language";
import { HttpError } from "./http";
import { createHash } from "node:crypto";

export type AnalysisRef = {
  entityId: string;
  hash: string;
  type: SignalEntityType;
};
export type AnalysisInput = AnalysisRef & { input: DerivedContent };
export type BatchAiOutcome = { ai: AiResult } | { error: unknown };
type PersistedResult = Extract<
  AiResult,
  { status: "ready" | "unsupported_language" }
>;
export type AnalysisCompletion = {
  analysis: Analysis;
  type: SignalEntityType;
  result: PersistedResult | null;
};
export const analysisKey = (ref: AnalysisRef) => `${ref.entityId}:${ref.hash}`;
export interface BatchAnalysisLease {
  locked: Set<string>;
  load(refs: AnalysisRef[]): Promise<Map<string, Analysis>>;
  claim(items: AnalysisInput[], userId: string): Promise<Map<string, Analysis>>;
  save(completions: AnalysisCompletion[]): Promise<void>;
  fail(ids: string[]): Promise<void>;
  release(): Promise<void>;
}
export interface BatchAnalysisStore {
  load(refs: AnalysisRef[]): Promise<Map<string, Analysis>>;
  lock(refs: AnalysisRef[]): Promise<BatchAnalysisLease | null>;
}
const refJson = (refs: AnalysisRef[]) =>
  JSON.stringify(
    refs.map((ref) => ({ entity_id: ref.entityId, content_hash: ref.hash })),
  );
async function loadMany(
  client: Pick<PoolClient, "query">,
  refs: AnalysisRef[],
) {
  if (!refs.length) return new Map<string, Analysis>();
  const { rows } = await client.query(
    `SELECT a.*, COALESCE((SELECT json_agg(json_build_object('key',s.signal_key,'score',s.score) ORDER BY s.signal_key) FROM ai_content_signals s WHERE s.analysis_id=a.id),'[]') AS signals
    FROM content_analyses a JOIN jsonb_to_recordset($1::jsonb) AS r(entity_id uuid,content_hash text) ON a.entity_id=r.entity_id AND a.content_hash=r.content_hash`,
    [refJson(refs)],
  );
  return new Map<string, Analysis>(
    rows.map((a) => {
      const analysis: Analysis = {
        id: a.id,
        entityId: a.entity_id,
        contentHash: a.content_hash,
        userId: a.user_id,
        input: a.input,
        status: a.status,
        generatorVersion: a.generator_version,
        detectedLanguage: a.detected_language,
        generatedAt: a.generated_at,
        expiresAt: a.expires_at,
        updatedAt: a.updated_at,
        signals: a.signals,
      };
      return [`${analysis.entityId}:${analysis.contentHash}`, analysis];
    }),
  );
}
export const postgresBatchAnalysisStore: BatchAnalysisStore = {
  load: (refs) => loadMany(pool, refs),
  async lock(refs) {
    if (!refs.length || !process.env.DATABASE_URL_UNPOOLED) return null;
    const client = await generationPool.connect();
    const keys = [
      ...new Set(refs.map((ref) => `ai:${analysisKey(ref)}`)),
    ].sort();
    let held: string[] = [];
    const unlock = () =>
      client.query(
        "SELECT pg_advisory_unlock(hashtextextended(k,0)) FROM unnest($1::text[]) AS k",
        [held],
      );
    try {
      const deadline = Date.now() + 7000;
      while (true) {
        const { rows } = await client.query(
          "SELECT k,pg_try_advisory_lock(hashtextextended(k,0)) AS locked FROM unnest($1::text[]) AS k",
          [keys],
        );
        held = rows.filter((row) => row.locked).map((row) => row.k);
        if (held.length === keys.length || Date.now() >= deadline) break;
        // Release partial acquisitions before waiting: overlapping batches cannot deadlock.
        await unlock();
        held = [];
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      return {
        locked: new Set(held.map((key) => key.slice(3))),
        load: (refs) => loadMany(client, refs),
        async claim(items, userId) {
          if (!items.length) return new Map();
          const input = JSON.stringify(
            items.map((item) => ({
              entity_id: item.entityId,
              content_hash: item.hash,
              input: item.input,
              generator_version: generatorVersion(item.type),
            })),
          );
          await client.query("BEGIN");
          try {
            await client.query(
              `DELETE FROM content_analyses a USING jsonb_to_recordset($1::jsonb) AS r(entity_id uuid,content_hash text) WHERE a.entity_id=r.entity_id AND a.content_hash=r.content_hash AND a.expires_at<=now()`,
              [input],
            );
            await client.query(
              `INSERT INTO content_analyses(entity_id,content_hash,user_id,input,status,generator_version,expires_at)
              SELECT entity_id,content_hash,$2::uuid,input,'pending',generator_version,now()+interval '1 month' FROM jsonb_to_recordset($1::jsonb) AS r(entity_id uuid,content_hash text,input jsonb,generator_version text)
              ON CONFLICT(entity_id,content_hash) DO UPDATE SET status='pending',updated_at=now()`,
              [input, userId],
            );
            const claimed = await loadMany(client, items);
            if (claimed.size !== items.length)
              throw Error("Incomplete batch claim");
            await client.query("COMMIT");
            return claimed;
          } catch (error) {
            await client.query("ROLLBACK");
            throw error;
          }
        },
        async save(completions) {
          if (!completions.length) return;
          const ids = completions.map((c) => c.analysis.id);
          const updates = JSON.stringify(
            completions.map((c) => ({
              id: c.analysis.id,
              status: c.result?.status ?? "failed",
              detected_language:
                c.result?.status === "unsupported_language"
                  ? c.result.detectedLanguage
                  : null,
              generated_at:
                c.result?.status === "ready"
                  ? c.result.generatedAt
                  : c.result
                    ? new Date().toISOString()
                    : null,
              generator_version: generatorVersion(c.type),
            })),
          );
          const signals = JSON.stringify(
            completions.flatMap((c) =>
              c.result?.status === "ready"
                ? c.result.signals.map((s) => ({
                    analysis_id: c.analysis.id,
                    signal_key: s.key,
                    score: s.score,
                  }))
                : [],
            ),
          );
          await client.query("BEGIN");
          try {
            await client.query(
              "DELETE FROM ai_content_signals WHERE analysis_id=ANY($1::uuid[])",
              [ids],
            );
            await client.query(
              `INSERT INTO ai_content_signals(analysis_id,signal_key,score) SELECT analysis_id,signal_key,score FROM jsonb_to_recordset($1::jsonb) AS s(analysis_id uuid,signal_key text,score double precision)`,
              [signals],
            );
            const updated = await client.query(
              `UPDATE content_analyses a SET status=r.status,detected_language=r.detected_language,
              generated_at=CASE WHEN r.status='failed' THEN a.generated_at ELSE r.generated_at END,
              generator_version=CASE WHEN r.status='failed' THEN a.generator_version ELSE r.generator_version END,
              expires_at=CASE WHEN r.status='failed' THEN a.expires_at ELSE now()+interval '1 month' END,updated_at=now()
              FROM jsonb_to_recordset($1::jsonb) AS r(id uuid,status text,detected_language text,generated_at timestamptz,generator_version text) WHERE a.id=r.id`,
              [updates],
            );
            if (updated.rowCount !== completions.length)
              throw Error("Incomplete batch save");
            await client.query("COMMIT");
          } catch (error) {
            await client.query("ROLLBACK");
            throw error;
          }
        },
        async fail(ids) {
          if (ids.length)
            await client.query(
              "UPDATE content_analyses SET status='failed',updated_at=now() WHERE id=ANY($1::uuid[])",
              [ids],
            );
        },
        async release() {
          try {
            await unlock();
            client.release();
          } catch (error) {
            client.release(true);
            throw error;
          }
        },
      };
    } catch (error) {
      client.release(true);
      throw error;
    }
  },
};
// Reserve user and global attempts in one query, rather than two round trips per item.
export async function reserveAiBatchAttempts(
  userId: string,
  count: number,
  client: Pick<PoolClient, "query"> = pool,
) {
  const keys = [`ai:user:${userId}`, "ai:global"].map((key) =>
    createHash("sha256").update(key).digest("hex"),
  );
  const { rows } = await client.query(
    `INSERT INTO auth.api_rate_limits(key,count,expires_at) SELECT key,$2::int,now()+interval '1 minute' FROM unnest($1::text[]) AS key ORDER BY key
    ON CONFLICT(key) DO UPDATE SET count=CASE WHEN api_rate_limits.expires_at<=now() THEN EXCLUDED.count ELSE api_rate_limits.count+EXCLUDED.count END,
    expires_at=CASE WHEN api_rate_limits.expires_at<=now() THEN EXCLUDED.expires_at ELSE api_rate_limits.expires_at END RETURNING key,count`,
    [keys, count],
  );
  const remaining = keys.map((key, index) =>
    Math.max(
      0,
      [30, 120][index] - (rows.find((row) => row.key === key)!.count - count),
    ),
  );
  return Math.min(count, ...remaining);
}
export async function lookupAiSignalsBatch(
  refs: AnalysisRef[],
  store = postgresBatchAnalysisStore,
) {
  const rows = await store.load(refs);
  return refs.map((ref) =>
    cachedResult(rows.get(analysisKey(ref)) ?? null, Date.now(), ref.type),
  );
}
export async function ensureAiSignalsBatch(
  items: AnalysisInput[],
  userId: string,
  deps: {
    store: BatchAnalysisStore;
    derive: (
      type: SignalEntityType,
      input: DerivedContent,
    ) => Promise<{ key: string; score: number }[]>;
    limit: (userId: string, count: number) => Promise<number>;
  } = {
    store: postgresBatchAnalysisStore,
    derive: deriveAiSignals,
    limit: reserveAiBatchAttempts,
  },
): Promise<BatchAiOutcome[]> {
  const outcomes = new Map<string, BatchAiOutcome>();
  const firstInputs = new Map<string, AnalysisInput>();
  for (const item of items)
    if (!firstInputs.has(analysisKey(item)))
      firstInputs.set(analysisKey(item), item);
  const unique = [...firstInputs.values()];
  let lease: BatchAnalysisLease | null = null;
  let claimed = new Map<string, Analysis>();
  const unavailable = (): BatchAiOutcome => ({
    ai: { status: "unavailable", retryable: true },
  });
  try {
    const cached = await deps.store.load(unique);
    const missing = unique.filter((item) => {
      const ai = cachedResult(
        cached.get(analysisKey(item)) ?? null,
        Date.now(),
        item.type,
      );
      if (ai.status === "ready" || ai.status === "unsupported_language") {
        outcomes.set(analysisKey(item), { ai });
        return false;
      }
      return true;
    });
    if (missing.length) {
      lease = await deps.store.lock(missing);
      if (lease) {
        const current = await lease.load(missing);
        const candidates = missing.filter((item) => {
          const key = analysisKey(item),
            existing = current.get(key),
            ai = cachedResult(existing ?? null, Date.now(), item.type);
          if (ai.status === "ready" || ai.status === "unsupported_language") {
            outcomes.set(key, { ai });
            return false;
          }
          if (
            !lease!.locked.has(key) ||
            (existing?.status === "failed" &&
              existing.expiresAt.getTime() > Date.now() &&
              existing.updatedAt.getTime() > Date.now() - 10000)
          ) {
            outcomes.set(key, unavailable());
            return false;
          }
          return true;
        });
        if (candidates.length) {
          const allowed = await deps.limit(userId, candidates.length);
          for (const item of candidates.slice(allowed))
            outcomes.set(analysisKey(item), {
              error: new HttpError(429, "Too many analysis requests."),
            });
          const admitted = candidates.slice(0, allowed);
          claimed = await lease.claim(admitted, userId);
          const completions = await Promise.all(
            admitted.map(async (item) => {
              const key = analysisKey(item),
                analysis = claimed.get(key)!;
              try {
                const input = sanitizeContent(item.type, analysis.input);
                if (hashContent(item.type, input) !== item.hash)
                  throw Error("Stored hash mismatch");
                const language = checkContentLanguage(input);
                const result: PersistedResult =
                  language ??
                  (await (async () => {
                    const signals = await deps.derive(item.type, input);
                    if (!completeSignalSet(item.type, signals))
                      throw Error("Incomplete signal set");
                    return aiResultSchema.parse({
                      status: "ready",
                      signals,
                      generatedAt: new Date().toISOString(),
                    }) as PersistedResult;
                  })());
                return { analysis, type: item.type, result };
              } catch {
                return { analysis, type: item.type, result: null };
              }
            }),
          );
          // Publish outcomes only after every result is durably committed.
          await lease.save(completions);
          for (const completion of completions)
            outcomes.set(
              `${completion.analysis.entityId}:${completion.analysis.contentHash}`,
              completion.result ? { ai: completion.result } : unavailable(),
            );
        }
      }
    }
  } catch (error) {
    await lease?.fail([...claimed.values()].map((a) => a.id)).catch(() => {});
    console.warn("AI batch database processing failed", {
      errorName: error instanceof Error ? error.name : "UnknownError",
    });
  } finally {
    try {
      await lease?.release();
    } catch {
      console.warn("AI batch lock release failed");
    }
  }
  return items.map((item) => outcomes.get(analysisKey(item)) ?? unavailable());
}
