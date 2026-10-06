import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { z } from "zod";
import { pool } from "./db";
import {
  aiSignalKeys,
  aiResultSchema,
  type AiResult,
} from "./contracts/overview";
import {
  mapYouTubePayload,
  validateYouTubeComments,
} from "./ai/youtube-video.mapper";
import {
  buildYouTubeContext,
  youtubeSignalQuestions,
} from "./ai/youtube-video.context";
import { runJev } from "./ai/jev-runner";
import { GENERATOR_VERSION } from "./ai/config";
import { checkMetadataLanguage } from "./ai/language";
export const AI_CACHE_TTL = "1 month";
export { GENERATOR_VERSION } from "./ai/config";
export { mapYouTubePayload } from "./ai/youtube-video.mapper";
// Session advisory locks require a direct connection, not Neon's transaction pooler.
export const generationPool = new Pool({
  connectionString: process.env.DATABASE_URL_UNPOOLED,
  max: 3,
  connectionTimeoutMillis: 3000,
});
generationPool.on("error", () =>
  console.error("AI generation database connection closed."),
);
export async function fetchYouTubePayload(videoId: string): Promise<unknown> {
  if (!process.env.YOUTUBE_DATA_API_KEY)
    throw Error("YouTube data is not configured");
  const query = new URLSearchParams({
    id: videoId,
    part: "snippet,contentDetails",
    key: process.env.YOUTUBE_DATA_API_KEY,
  });
  const response = await fetch(
    `https://www.googleapis.com/youtube/v3/videos?${query}`,
    { signal: AbortSignal.timeout(5000), cache: "no-store" },
  );
  if (!response.ok) throw Error("YouTube data is unavailable");
  const envelope = z
    .object({ items: z.array(z.unknown()).min(1) })
    .parse(await response.json());
  const resource = envelope.items[0];
  // Validate identity without stripping any provider fields from the raw resource.
  mapYouTubePayload(resource, videoId);
  // Enrich this canonical video only; no list envelope or unrelated resources.
  const commentThreads = await fetchYouTubeComments(videoId);
  const enriched = { ...(resource as Record<string, unknown>), commentThreads };
  mapYouTubePayload(enriched, videoId);
  return enriched;
}
export async function fetchYouTubeComments(videoId: string) {
  const missing = (status: "disabled" | "unavailable") => ({
    status,
    order: "relevance" as const,
    items: [],
  });
  const query = new URLSearchParams({
    videoId,
    part: "snippet",
    maxResults: "10",
    order: "relevance",
    textFormat: "plainText",
    key: process.env.YOUTUBE_DATA_API_KEY ?? "",
  });
  try {
    const response = await fetch(
      `https://www.googleapis.com/youtube/v3/commentThreads?${query}`,
      {
        signal: AbortSignal.timeout(5000),
        cache: "no-store",
      },
    );
    if (!response.ok) {
      const error = await response.json().catch(() => null);
      return missing(
        response.status === 403 &&
          error?.error?.errors?.some(
            (item: { reason?: string }) => item.reason === "commentsDisabled",
          )
          ? "disabled"
          : "unavailable",
      );
    }
    const envelope = z
      .object({ items: z.array(z.unknown()).max(10) })
      .parse(await response.json());
    // Validate each thread's identity and model-relevant fields before storing it.
    // A malformed supplemental response should not discard a valid video resource.
    const sample = {
      status: "ready" as const,
      order: "relevance" as const,
      items: envelope.items,
    };
    validateYouTubeComments(sample, videoId);
    return sample;
  } catch {
    return missing("unavailable");
  }
}
export async function deriveAiSignals(
  input: ReturnType<typeof mapYouTubePayload>,
) {
  return runJev(buildYouTubeContext(input), youtubeSignalQuestions);
}
const cooldown = new Map<string, number>();
export async function ensureAiSignals(
  entityId: string,
  videoId: string,
  deps = { fetchPayload: fetchYouTubePayload, derive: deriveAiSignals },
): Promise<AiResult> {
  const unavailable = { status: "unavailable", retryable: true } as const;
  async function cached() {
    const { rows } = await pool.query(
      `SELECT p.provider,p.payload,s.signal_key as key,s.score,s.updated_at
       FROM content_payloads p LEFT JOIN ai_content_signals s
         ON s.entity_id=p.entity_id AND p.revision=s.payload_revision
         AND s.updated_at >= now()-$2::interval
       WHERE p.entity_id=$1 AND p.status='ready' ORDER BY s.signal_key`,
      [entityId, AI_CACHE_TTL],
    );
    if (rows.length) {
      if (rows[0].provider !== "youtube_data_api_v3")
        throw Error("Unsupported payload provider");
      const language = checkMetadataLanguage(
        mapYouTubePayload(rows[0].payload, videoId),
      );
      if (language) return language;
    }
    if (
      rows.length !== aiSignalKeys.length ||
      !aiSignalKeys.every((key) => rows.some((r) => r.key === key))
    )
      return null;
    return aiResultSchema.parse({
      status: "ready",
      signals: rows.map(({ key, score }) => ({ key, score })),
      generatedAt: rows[0].updated_at.toISOString(),
    });
  }
  const saved = await cached();
  if (saved) return saved;
  if ((cooldown.get(entityId) ?? 0) > Date.now()) return unavailable;
  if (!process.env.DATABASE_URL_UNPOOLED) return unavailable;
  const c = await generationPool.connect();
  let locked = false;
  try {
    const deadline = Date.now() + 7000;
    do {
      locked = (
        await c.query(
          "SELECT pg_try_advisory_lock(hashtextextended($1,0)) AS locked",
          [`ai:${entityId}`],
        )
      ).rows[0].locked;
      if (locked) break;
      const result = await cached();
      if (result) return result;
      await new Promise((resolve) => setTimeout(resolve, 150));
    } while (Date.now() < deadline);
    if (!locked) return unavailable;
    const existing = await cached();
    if (existing) return existing;
    let payload = (
      await c.query("SELECT * FROM content_payloads WHERE entity_id=$1", [
        entityId,
      ])
    ).rows[0];
    if (!payload || payload.status === "stale") {
      const raw = await deps.fetchPayload(videoId);
      mapYouTubePayload(raw, videoId);
      payload = (
        await c.query(
          `INSERT INTO content_payloads(entity_id,provider,payload,revision) VALUES($1,'youtube_data_api_v3',$2,$3) ON CONFLICT(entity_id) DO UPDATE SET provider=EXCLUDED.provider,payload=EXCLUDED.payload,revision=EXCLUDED.revision,status='ready',updated_at=now() RETURNING *`,
          [entityId, JSON.stringify(raw), randomUUID()],
        )
      ).rows[0];
    }
    if (payload.provider !== "youtube_data_api_v3")
      throw Error("Unsupported payload provider");
    const input = mapYouTubePayload(payload.payload, videoId);
    const language = checkMetadataLanguage(input);
    if (language) return language;
    const signals = (await deps.derive(input)).sort((a, b) =>
      a.key.localeCompare(b.key),
    );
    const result = aiResultSchema.parse({
      status: "ready",
      signals,
      generatedAt: new Date().toISOString(),
    });
    if (
      signals.length !== aiSignalKeys.length ||
      !aiSignalKeys.every(
        (key) => signals.filter((s) => s.key === key).length === 1,
      )
    )
      throw Error("Incomplete AI signal set");
    await c.query("BEGIN");
    try {
      // Coordinate with a future stale-marking job; never publish a mismatched revision.
      const current = (
        await c.query(
          "SELECT revision,status FROM content_payloads WHERE entity_id=$1 FOR UPDATE",
          [entityId],
        )
      ).rows[0];
      if (current.revision !== payload.revision || current.status !== "ready")
        throw Error("Payload changed during generation");
      await c.query(
        "DELETE FROM ai_content_signals WHERE entity_id=$1 AND NOT (signal_key=ANY($2::text[]))",
        [entityId, aiSignalKeys],
      );
      for (const s of signals)
        await c.query(
          `INSERT INTO ai_content_signals(entity_id,signal_key,score,payload_revision,generator_version,updated_at) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(entity_id,signal_key) DO UPDATE SET score=EXCLUDED.score,payload_revision=EXCLUDED.payload_revision,generator_version=EXCLUDED.generator_version,updated_at=EXCLUDED.updated_at`,
          [
            entityId,
            s.key,
            s.score,
            payload.revision,
            GENERATOR_VERSION,
            result.status === "ready" ? result.generatedAt : null,
          ],
        );
      await c.query("COMMIT");
    } catch (e) {
      await c.query("ROLLBACK");
      throw e;
    }
    cooldown.delete(entityId);
    return result;
  } catch {
    // Short process-local backoff; quota limiting also applies across instances at the route.
    if (cooldown.size > 1000) cooldown.clear();
    cooldown.set(entityId, Date.now() + 10000);
    return unavailable;
  } finally {
    if (locked) {
      try {
        await c.query("SELECT pg_advisory_unlock(hashtextextended($1,0))", [
          `ai:${entityId}`,
        ]);
      } catch {
        c.release(true);
        throw Error("Could not release generation lock");
      }
    }
    c.release();
  }
}
