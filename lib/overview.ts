import { z } from "zod";
import { pool } from "./db";
import { normalizeIdentity } from "./identity";
import {
  lookupItemSchema,
  sanitizeContent,
  hashContent,
  type LookupItem,
  type DerivedContent,
} from "./contracts/content";
import { ensureAiSignalsBatch, lookupAiSignalsBatch } from "./ai-batch";
import {
  overviewSchema,
  batchOverviewSchema,
  type AiResult,
} from "./contracts/overview";

type Entity = {
  id: string;
  entity_type: string;
  external_id: string | null;
  canonical_url: string | null;
};
const entityKey = (type: string, value: string) => `${type}:${value}`;
async function resolveEntities(items: LookupItem[]) {
  const identities = items.map((item) =>
    normalizeIdentity({
      entityType: item.entityType,
      url: item.url,
      externalId: item.externalId,
    }),
  );
  const entities = new Map<string, Entity>();
  // Separate conflict targets support both canonical URLs and external IDs.
  for (const column of ["canonical_url", "external_id"] as const) {
    const values = [
      ...new Map(
        identities
          .filter((i) => (column === "canonical_url" ? !!i.url : !i.url))
          .map((i) => {
            const value = i.url ?? i.externalId!;
            return [
              entityKey(i.entityType, value),
              { entity_type: i.entityType, value },
            ];
          }),
      ).values(),
    ];
    if (!values.length) continue;
    const { rows } = await pool.query(
      `INSERT INTO entities(entity_type,${column}) SELECT entity_type,value FROM jsonb_to_recordset($1::jsonb) AS r(entity_type text,value text) ORDER BY entity_type,value
      ON CONFLICT(entity_type,${column}) DO UPDATE SET ${column}=EXCLUDED.${column} RETURNING *`,
      [JSON.stringify(values)],
    );
    for (const row of rows)
      entities.set(
        entityKey(row.entity_type, row.canonical_url ?? row.external_id),
        row,
      );
  }
  return identities.map((i) =>
    entities.get(entityKey(i.entityType, i.url ?? i.externalId!))!,
  );
}
export async function resolveEntity(item: LookupItem) {
  return (await resolveEntities([item]))[0];
}
function buildOverview(
  entity: Entity,
  ai: AiResult,
  row: {
    slop: number;
    not_slop: number;
    signals: unknown;
    personal: string | null;
  },
  userId?: string,
) {
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
async function communityForEntities(entities: Entity[], userId?: string) {
  if (!entities.length) return new Map();
  const ids = [...new Set(entities.map((entity) => entity.id))];
  const { rows } = await pool.query(
    `WITH requested AS (SELECT unnest($1::uuid[]) AS id), votes AS (SELECT * FROM content_votes WHERE entity_id=ANY($1::uuid[])),
    totals AS (SELECT entity_id,count(*) FILTER(WHERE vote='slop')::int AS slop,count(*) FILTER(WHERE vote='not_slop')::int AS not_slop FROM votes GROUP BY entity_id),
    counts AS (SELECT v.entity_id,s.key,count(*)::int AS count FROM votes v JOIN content_vote_signals vs ON vs.entity_id=v.entity_id AND vs.user_id=v.user_id JOIN slop_signals s ON s.id=vs.signal_id WHERE v.vote='slop' GROUP BY v.entity_id,s.key),
    signals AS (SELECT entity_id,json_agg(json_build_object('key',key,'count',count) ORDER BY count DESC,key) AS signals FROM counts GROUP BY entity_id)
    SELECT r.id,COALESCE(t.slop,0) AS slop,COALESCE(t.not_slop,0) AS not_slop,COALESCE(s.signals,'[]'::json) AS signals,v.vote AS personal
    FROM requested r LEFT JOIN totals t ON t.entity_id=r.id LEFT JOIN signals s ON s.entity_id=r.id LEFT JOIN votes v ON v.entity_id=r.id AND v.user_id=$2::uuid`,
    [ids, userId ?? null],
  );
  return new Map(rows.map((row) => [row.id, row]));
}
export async function overviewForEntity(
  entity: Entity,
  ai: AiResult,
  userId?: string,
) {
  return buildOverview(
    entity,
    ai,
    (await communityForEntities([entity], userId)).get(entity.id),
    userId,
  );
}
function itemError(
  index: number,
  request: LookupItem | undefined,
  error: unknown,
) {
  const status = (error as { status?: number }).status;
  const invalid =
    error instanceof z.ZodError ||
    /Invalid|Unsupported|Content|Video|comments/i.test(
      (error as Error).message,
    );
  return {
    index,
    request: request ?? null,
    status: "error",
    error: {
      code:
        status === 429
          ? "rate_limited"
          : invalid
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
      retryable: status === 429 || (!status && !invalid),
    },
  };
}
const deriveItemSchema = z
  .object({
    entityType: z.unknown(),
    url: z.unknown().optional(),
    externalId: z.unknown().optional(),
    contentHash: z.unknown(),
    content: z.unknown(),
  })
  .strict();
export async function batchOverviews(
  items: unknown[],
  userId?: string,
  derive = false,
) {
  const results: unknown[] = new Array(items.length);
  const valid: {
    index: number;
    request: LookupItem;
    content?: DerivedContent;
  }[] = [];
  for (const [index, raw] of items.entries()) {
    let request: LookupItem | undefined;
    try {
      const data = derive ? deriveItemSchema.parse(raw) : raw;
      request = lookupItemSchema.parse(
        derive
          ? (({ content, ...rest }) => rest)(data as { content: unknown })
          : data,
      );
      // Normalize each item before the bulk phase to isolate malformed identities.
      normalizeIdentity({
        entityType: request.entityType,
        url: request.url,
        externalId: request.externalId,
      });
      let content: DerivedContent | undefined;
      if (derive) {
        content = sanitizeContent(
          request.entityType,
          (data as { content: unknown }).content,
        );
        if (hashContent(request.entityType, content) !== request.contentHash)
          throw Error("Content hash mismatch");
      }
      valid.push({ index, request, content });
    } catch (error) {
      results[index] = itemError(index, request, error);
    }
  }
  if (valid.length) {
    try {
      const entities = await resolveEntities(valid.map((item) => item.request));
      const refs = valid.map((item, i) => ({
        entityId: entities[i].id,
        hash: item.request.contentHash,
        type: item.request.entityType,
      }));
      const outcomes = derive
        ? await ensureAiSignalsBatch(
            refs.map((ref, i) => ({ ...ref, input: valid[i].content! })),
            userId!,
          )
        : (await lookupAiSignalsBatch(refs)).map((ai) => ({ ai }));
      const community = await communityForEntities(entities, userId);
      for (const [i, item] of valid.entries()) {
        const outcome = outcomes[i];
        if ("error" in outcome) {
          results[item.index] = itemError(
            item.index,
            item.request,
            outcome.error,
          );
          continue;
        }
        try {
          results[item.index] = {
            index: item.index,
            request: item.request,
            status: "success",
            overview: buildOverview(
              entities[i],
              outcome.ai,
              community.get(entities[i].id),
              userId,
            ),
          };
        } catch (error) {
          results[item.index] = itemError(item.index, item.request, error);
        }
      }
    } catch (error) {
      console.warn("Content batch database processing failed", {
        errorName: error instanceof Error ? error.name : "UnknownError",
        errorCode: (error as { code?: string }).code ?? null,
      });
      for (const item of valid)
        results[item.index] = itemError(item.index, item.request, error);
    }
  }
  return batchOverviewSchema.parse({ results });
}
