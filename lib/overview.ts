import { z } from "zod";
import { pool } from "./db";
import { normalizeIdentity } from "./identity";
import {
  lookupItemSchema,
  sanitizeContent,
  hashContent,
  type LookupItem,
} from "./contracts/content";
import { lookupAiSignals, ensureAiSignals } from "./ai-signals";
import {
  overviewSchema,
  batchOverviewSchema,
  type AiResult,
} from "./contracts/overview";
export async function resolveEntity(item: LookupItem) {
  const i = normalizeIdentity({
    entityType: item.entityType,
    url: item.url,
    externalId: item.externalId,
  });
  const column = i.url ? "canonical_url" : "external_id";
  const { rows } = await pool.query(
    `INSERT INTO entities(entity_type,${column}) VALUES($1,$2) ON CONFLICT(entity_type,${column}) DO UPDATE SET ${column}=EXCLUDED.${column} RETURNING *`,
    [i.entityType, i.url ?? i.externalId],
  );
  return rows[0];
}
export async function overviewForEntity(
  entity: {
    id: string;
    entity_type: string;
    external_id: string | null;
    canonical_url: string | null;
  },
  ai: AiResult,
  userId?: string,
) {
  const { rows } = await pool.query(
    `WITH votes AS (SELECT * FROM content_votes WHERE entity_id=$1), counts AS (SELECT s.key,count(*)::int AS count FROM votes v JOIN content_vote_signals vs ON vs.entity_id=v.entity_id AND vs.user_id=v.user_id JOIN slop_signals s ON s.id=vs.signal_id WHERE v.vote='slop' GROUP BY s.key) SELECT count(*) FILTER(WHERE vote='slop')::int AS slop,count(*) FILTER(WHERE vote='not_slop')::int AS not_slop,COALESCE((SELECT json_agg(counts ORDER BY count DESC,key) FROM counts),'[]') AS signals,(SELECT vote FROM votes WHERE user_id=$2) AS personal FROM votes`,
    [entity.id, userId ?? null],
  );
  const row = rows[0];
  return overviewSchema.parse({
    entity: {
      id: entity.id,
      type: entity.entity_type,
      externalId: entity.external_id,
      canonicalUrl: entity.canonical_url,
    },
    community: {
      slopVotes: row.slop,
      notSlopVotes: row.not_slop,
      signals: row.signals,
    },
    viewer: userId
      ? { status: "authenticated", vote: row.personal ?? null }
      : { status: "anonymous" },
    ai,
  });
}
export async function batchOverviews(
  items: unknown[],
  userId?: string,
  derive = false,
) {
  const results: unknown[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const index = next++,
        raw = items[index];
      let request: LookupItem | undefined;
      try {
        const data = derive
          ? z
              .object({
                entityType: z.unknown(),
                url: z.unknown().optional(),
                externalId: z.unknown().optional(),
                contentHash: z.unknown(),
                content: z.unknown(),
              })
              .strict()
              .parse(raw)
          : raw;
        request = lookupItemSchema.parse(
          derive
            ? (({ content, ...rest }) => rest)(data as { content: unknown })
            : data,
        );
        let content: unknown;
        if (derive) {
          content = sanitizeContent(
            request.entityType,
            (data as { content: unknown }).content,
          );
          if (
            hashContent(
              request.entityType,
              content as ReturnType<typeof sanitizeContent>,
            ) !== request.contentHash
          )
            throw Error("Content hash mismatch");
        }
        const entity = await resolveEntity(request);
        const ai = derive
          ? await ensureAiSignals(
              entity.id,
              request.entityType,
              request.contentHash,
              content,
              userId!,
            )
          : await lookupAiSignals(
              entity.id,
              request.contentHash,
              undefined,
              request.entityType,
            );
        results[index] = {
          index,
          request,
          status: "success",
          overview: await overviewForEntity(entity, ai, userId),
        };
      } catch (error) {
        const status = (error as { status?: number }).status;
        results[index] = {
          index,
          request: request ?? null,
          status: "error",
          error: {
            code:
              status === 429
                ? "rate_limited"
                : error instanceof z.ZodError ||
                    /Invalid|Unsupported|Content|Video|comments/i.test(
                      (error as Error).message,
                    )
                  ? "invalid_input"
                  : "unavailable",
            message:
              status === 429
                ? "Too many analysis requests."
                : error instanceof z.ZodError
                  ? "Invalid entity input."
                  : /hash mismatch/.test((error as Error).message)
                    ? "Content hash mismatch."
                    : "Could not process this entity.",
            retryable:
              status === 429 ||
              (!status &&
                !(error instanceof z.ZodError) &&
                !/Invalid|Unsupported|Content|Video|comments/i.test(
                  (error as Error).message,
                )),
          },
        };
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(2, items.length) }, worker));
  return batchOverviewSchema.parse({ results });
}
