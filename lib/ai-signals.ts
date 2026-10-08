import {
  signalsFor,
  completeSignalSet,
  type SignalEntityType,
  youtubeSignalKeys,
  linkedinSignalKeys,
} from "./contracts/signals";
import { Pool, type PoolClient } from "pg";
import { pool } from "./db";
import { aiResultSchema, type AiResult } from "./contracts/overview";
import {
  sanitizeContent,
  hashContent,
  type DerivedContent,
  type ContentIdentity,
} from "./contracts/content";
import { checkContentLanguage } from "./ai/language";
import {
  buildYouTubeContext,
  youtubeSignalQuestions,
} from "./ai/youtube-video.context";
import {
  buildLinkedInContext,
  linkedinSignalQuestions,
} from "./ai/linkedin-post.context";
import { runJev } from "./ai/jev-runner";
import { generatorVersion } from "./ai/config";
import { rateLimit } from "./http";
export { GENERATOR_VERSION } from "./ai/config";
export const AI_CACHE_TTL = "1 month";
export const generationPool = new Pool({
  connectionString: process.env.DATABASE_URL_UNPOOLED,
  max: 10,
  connectionTimeoutMillis: 3000,
});
generationPool.on("error", () =>
  console.error("AI generation database connection closed."),
);
export type Analysis = {
  id: string;
  entityId: string;
  contentHash: string;
  userId: string | null;
  input: DerivedContent;
  status: string;
  generatorVersion: string;
  detectedLanguage: string | null;
  generatedAt: Date | null;
  expiresAt: Date;
  updatedAt: Date;
  signals: { key: string; score: number }[];
};
export interface AnalysisLease {
  load(): Promise<Analysis | null>;
  claim(input: DerivedContent, userId: string): Promise<Analysis>;
  fail(): Promise<void>;
  save(
    result: Exclude<
      AiResult,
      { status: "needs_input" } | { status: "unavailable" }
    >,
  ): Promise<void>;
  release(): Promise<void>;
}
export interface AnalysisStore {
  load(entityId: string, hash: string): Promise<Analysis | null>;
  lock(entityId: string, hash: string): Promise<AnalysisLease | null>;
}
async function load(
  client: { query: PoolClient["query"] },
  entityId: string,
  hash: string,
): Promise<Analysis | null> {
  const { rows } = await client.query(
    `SELECT a.*,COALESCE((SELECT json_agg(json_build_object('key',s.signal_key,'score',s.score) ORDER BY s.signal_key) FROM ai_content_signals s WHERE s.analysis_id=a.id),'[]') AS signals FROM content_analyses a WHERE entity_id=$1 AND content_hash=$2`,
    [entityId, hash],
  );
  if (!rows[0]) return null;
  const a = rows[0];
  return {
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
}
export function cachedResult(
  a: Analysis | null,
  now = Date.now(),
  type: SignalEntityType = a?.input && Object.prototype.hasOwnProperty.call(a.input, "title")
    ? "youtube_video"
    : "linkedin_post",
): AiResult {
  if (!a || a.expiresAt.getTime() <= now) return { status: "needs_input" };
  if (a.generatorVersion !== generatorVersion(type))
    return { status: "needs_input" };
  if (a.status === "unsupported_language")
    return aiResultSchema.parse({
      status: a.status,
      detectedLanguage: a.detectedLanguage,
    });
  if (a.status !== "ready") return { status: "unavailable", retryable: true };
  if (!completeSignalSet(type, a.signals)) return { status: "needs_input" };
  const parsed = aiResultSchema.safeParse({
    status: "ready",
    signals: signalsFor(type).map((key) =>
      a.signals.find((signal) => signal.key === key)!,
    ),
    generatedAt: a.generatedAt?.toISOString(),
  });
  return parsed.success ? parsed.data : { status: "needs_input" };
}
export const postgresAnalysisStore: AnalysisStore = {
  load: (id, hash) => load(pool, id, hash),
  async lock(entityId, hash) {
    if (!process.env.DATABASE_URL_UNPOOLED) return null;
    const c = await generationPool.connect(),
      key = `ai:${entityId}:${hash}`;
    let locked = false;
    try {
      const deadline = Date.now() + 7000;
      do {
        locked = (
          await c.query(
            "SELECT pg_try_advisory_lock(hashtextextended($1,0)) AS locked",
            [key],
          )
        ).rows[0].locked;
        if (locked) break;
        await new Promise((r) => setTimeout(r, 100));
      } while (Date.now() < deadline);
      if (!locked) {
        c.release();
        return null;
      }
    } catch (error) {
      c.release(true);
      throw error;
    }
    let analysis: Analysis | null = null;
    return {
      async load() {
        return load(c, entityId, hash);
      },
      async claim(input, userId) {
        await c.query("BEGIN");
        try {
          await c.query(
            "DELETE FROM content_analyses WHERE entity_id=$1 AND content_hash=$2 AND expires_at<=now()",
            [entityId, hash],
          );
          await c.query(
            `INSERT INTO content_analyses(entity_id,content_hash,user_id,input,status,generator_version,expires_at) VALUES($1,$2,$3,$4,'pending',$5,now()+interval '1 month') ON CONFLICT(entity_id,content_hash) DO NOTHING`,
            [
              entityId,
              hash,
              userId,
              JSON.stringify(input),
              generatorVersion(
                "title" in input ? "youtube_video" : "linkedin_post",
              ),
            ],
          );
          analysis = (await load(c, entityId, hash))!;
          await c.query(
            "UPDATE content_analyses SET status='pending',updated_at=now() WHERE id=$1",
            [analysis.id],
          );
          await c.query("COMMIT");
          return analysis;
        } catch (e) {
          await c.query("ROLLBACK");
          throw e;
        }
      },
      async fail() {
        if (analysis)
          await c.query(
            "UPDATE content_analyses SET status='failed',updated_at=now() WHERE id=$1",
            [analysis.id],
          );
      },
      async save(result) {
        if (!analysis) throw Error("Missing analysis claim");
        await c.query("BEGIN");
        try {
          await c.query("DELETE FROM ai_content_signals WHERE analysis_id=$1", [
            analysis.id,
          ]);
          if (result.status === "ready")
            for (const signal of result.signals)
              await c.query(
                "INSERT INTO ai_content_signals(analysis_id,signal_key,score) VALUES($1,$2,$3)",
                [analysis.id, signal.key, signal.score],
              );
          await c.query(
            "UPDATE content_analyses SET status=$2,detected_language=$3,generated_at=$4,generator_version=$5,expires_at=now()+interval '1 month',updated_at=now() WHERE id=$1",
            [
              analysis.id,
              result.status,
              result.status === "unsupported_language"
                ? result.detectedLanguage
                : null,
              result.status === "ready"
                ? result.generatedAt
                : new Date().toISOString(),
              generatorVersion(
                "title" in analysis.input ? "youtube_video" : "linkedin_post",
              ),
            ],
          );
          await c.query("COMMIT");
        } catch (e) {
          await c.query("ROLLBACK");
          throw e;
        }
      },
      async release() {
        try {
          await c.query("SELECT pg_advisory_unlock(hashtextextended($1,0))", [
            key,
          ]);
          c.release();
        } catch {
          c.release(true);
          throw Error("Generation lock release failed");
        }
      },
    };
  },
};
export async function deriveAiSignals(
  type: "youtube_video",
  input: DerivedContent,
): Promise<{ key: (typeof youtubeSignalKeys)[number]; score: number }[]>;
export async function deriveAiSignals(
  type: "linkedin_post",
  input: DerivedContent,
): Promise<{ key: (typeof linkedinSignalKeys)[number]; score: number }[]>;
export async function deriveAiSignals(
  type: SignalEntityType,
  input: DerivedContent,
): Promise<{ key: (typeof linkedinSignalKeys)[number]; score: number }[]>;
export async function deriveAiSignals(
  type: ContentIdentity["entityType"],
  input: DerivedContent,
) {
  const signals = await (type === "youtube_video"
    ? runJev(buildYouTubeContext(input), youtubeSignalQuestions, {
        version: generatorVersion(type),
      })
    : runJev(
        buildLinkedInContext(sanitizeContent("linkedin_post", input)),
        linkedinSignalQuestions,
        { version: generatorVersion(type) },
      ));
  const result = aiResultSchema.parse({
    status: "ready",
    signals,
    generatedAt: new Date().toISOString(),
  });
  if (result.status !== "ready") throw Error("Invalid scores");
  return result.signals;
}
export async function lookupAiSignals(
  entityId: string,
  hash: string,
  store: AnalysisStore = postgresAnalysisStore,
  type?: SignalEntityType,
) {
  return cachedResult(await store.load(entityId, hash), Date.now(), type);
}
export async function ensureAiSignals(
  entityId: string,
  type: ContentIdentity["entityType"],
  hash: string,
  raw: unknown,
  userId: string,
  deps: {
    store: AnalysisStore;
    derive: (
      type: SignalEntityType,
      input: DerivedContent,
    ) => Promise<{ key: string; score: number }[]>;
    limit: (user: string) => Promise<void>;
  } = {
    store: postgresAnalysisStore,
    derive: deriveAiSignals,
    limit: async (user: string) => {
      await rateLimit(`ai:user:${user}`, 30);
      await rateLimit("ai:global", 120);
    },
  },
): Promise<AiResult> {
  const input = sanitizeContent(type, raw);
  if (hashContent(type, input) !== hash) throw Error("Content hash mismatch");
  const cached = cachedResult(
    await deps.store.load(entityId, hash),
    Date.now(),
    type,
  );
  if (cached.status === "ready" || cached.status === "unsupported_language")
    return cached;
  let lease: AnalysisLease | null = null;
  let claimed = false;
  try {
    lease = await deps.store.lock(entityId, hash);
    if (!lease) return { status: "unavailable", retryable: true };
    const existing = await lease.load(),
      saved = cachedResult(existing, Date.now(), type);
    if (saved.status === "ready" || saved.status === "unsupported_language")
      return saved;
    if (
      existing?.status === "failed" &&
      existing.expiresAt.getTime() > Date.now() &&
      existing.updatedAt.getTime() > Date.now() - 10000
    )
      return { status: "unavailable", retryable: true };
    await deps.limit(userId);
    const a = await lease.claim(input, userId);
    claimed = true;
    const accepted = sanitizeContent(type, a.input);
    if (hashContent(type, accepted) !== hash)
      throw Error("Stored hash mismatch");
    const language = checkContentLanguage(accepted);
    if (language) {
      await lease.save(language);
      return language;
    }
    const signals = await deps.derive(type, accepted);
    if (!completeSignalSet(type, signals)) throw Error("Incomplete signal set");
    const result = aiResultSchema.parse({
      status: "ready",
      signals,
      generatedAt: new Date().toISOString(),
    });
    if (result.status !== "ready") throw Error("Invalid result");
    await lease.save(result);
    return result;
  } catch (error) {
    if (claimed) await lease?.fail().catch(() => {});
    if ((error as { status?: number }).status === 429) throw error;
    return { status: "unavailable", retryable: true };
  } finally {
    await lease?.release();
  }
}
