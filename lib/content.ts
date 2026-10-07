import { normalizeIdentity } from "./identity";
import { type ContentIdentity } from "./contracts/content";
import { z } from "zod";
import type { PoolClient } from "pg";
import { pool } from "./db";
import { HttpError } from "./http";
import { signalKeys, signalsFor } from "./contracts/signals";
export { signalKeys } from "./contracts/signals";
export const videoIdSchema = z.string().regex(/^[A-Za-z0-9_-]{11}$/);
export const detailsSchema = z
  .object({
    signals: z
      .array(z.enum(signalKeys))
      .max(signalKeys.length)
      .refine((v) => new Set(v).size === v.length),
    otherText: z.string().trim().max(500),
    sourceUrl: z.string().trim().max(2048).optional(),
  })
  .strict();
export type Details = z.infer<typeof detailsSchema>;
export type Identity = {
  entityType: "youtube_video" | "youtube_channel" | "linkedin_post";
  externalId: string;
  canonicalUrl: string;
};
export function videoIdentity(id: string): Identity {
  videoIdSchema.parse(id);
  return {
    entityType: "youtube_video",
    externalId: id,
    canonicalUrl: `https://www.youtube.com/watch?v=${id}`,
  };
}
function contentIdentity(value: string | ContentIdentity): Identity {
  if (typeof value === "string") return videoIdentity(value);
  const i = normalizeIdentity(value);
  if (!i.url)
    throw new HttpError(400, "A canonical URL is required for contributions.");
  return {
    entityType: i.entityType,
    canonicalUrl: i.url,
    externalId: i.externalId ?? "",
  };
}
export async function resolveSource(value: string): Promise<Identity> {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new HttpError(400, "Enter a YouTube video or channel URL.");
  }
  if (
    !["https:", "http:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.port ||
    !["youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be"].includes(
      url.hostname,
    )
  )
    throw new HttpError(400, "Enter a YouTube video or channel URL.");
  const parts = url.pathname.split("/").filter(Boolean);
  const id =
    url.hostname === "youtu.be" && parts.length === 1
      ? parts[0]
      : url.pathname === "/watch"
        ? url.searchParams.get("v")
        : parts.length === 2 && ["shorts", "embed", "live"].includes(parts[0])
          ? parts[1]
          : null;
  if (id) return videoIdentity(id);
  if (url.hostname === "youtu.be")
    throw new HttpError(400, "Invalid video URL.");
  let channel =
    parts.length === 2 &&
    parts[0] === "channel" &&
    /^UC[A-Za-z0-9_-]{22}$/.test(parts[1])
      ? parts[1]
      : null;
  if (parts.length === 1 && parts[0].startsWith("@")) {
    throw new HttpError(
      422,
      "Use a video URL or a /channel/ URL; handle lookup is unavailable.",
    );
  }
  if (!channel || !/^UC[A-Za-z0-9_-]{22}$/.test(channel))
    throw new HttpError(400, "Enter a valid YouTube video or channel URL.");
  return {
    entityType: "youtube_channel",
    externalId: channel,
    canonicalUrl: `https://www.youtube.com/channel/${channel}`,
  };
}
export async function transaction<T>(
  work: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    const result = await work(c);
    await c.query("COMMIT");
    return result;
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  } finally {
    c.release();
  }
}
async function entity(c: PoolClient, i: Identity) {
  const { rows } = await c.query(
    `INSERT INTO entities(entity_type,canonical_url) VALUES($1,$2) ON CONFLICT(entity_type,canonical_url) DO UPDATE SET canonical_url=EXCLUDED.canonical_url RETURNING id`,
    [i.entityType, i.canonicalUrl],
  );
  return rows[0].id as string;
}
// Only videos can be rated. Source identity may be a video or channel.
export async function rating(videoId: string | ContentIdentity) {
  contentIdentity(videoId);
  const { rows } = await pool.query(
    `WITH video_votes AS (
       SELECT v.user_id, v.entity_id, v.vote FROM content_votes v
       JOIN entities e ON e.id=v.entity_id
       WHERE e.entity_type=$2 AND e.canonical_url=$1
     ), signal_counts AS (
       SELECT s.key, count(*)::int AS count
       FROM video_votes v
       JOIN content_vote_signals vs ON vs.user_id=v.user_id AND vs.entity_id=v.entity_id
       JOIN slop_signals s ON s.id=vs.signal_id
       WHERE v.vote='slop' GROUP BY s.key
     )
     SELECT count(*) FILTER(WHERE vote='slop')::int AS "slopVotes",
       count(*) FILTER(WHERE vote='not_slop')::int AS "notSlopVotes",
       COALESCE((SELECT json_agg(signal_counts ORDER BY count DESC,key) FROM signal_counts),'[]') AS "signalCounts"
     FROM video_votes`,
    [
      contentIdentity(videoId).canonicalUrl,
      contentIdentity(videoId).entityType,
    ],
  );
  return {
    targetId:
      typeof videoId === "string"
        ? videoId
        : contentIdentity(videoId).canonicalUrl,
    ...rows[0],
  };
}
export async function myVote(
  videoId: string | ContentIdentity,
  userId: string,
) {
  const { rows } = await pool.query(
    `SELECT v.vote FROM content_votes v JOIN entities e ON e.id=v.entity_id WHERE e.entity_type=$3 AND e.canonical_url=$1 AND v.user_id=$2`,
    [
      contentIdentity(videoId).canonicalUrl,
      userId,
      contentIdentity(videoId).entityType,
    ],
  );
  return { kind: "authenticated", vote: rows[0]?.vote ?? null };
}
export async function vote(
  videoId: string | ContentIdentity,
  userId: string,
  choice: "slop" | "not_slop",
) {
  const identity = contentIdentity(videoId);
  await transaction(async (c) => {
    const id = await entity(c, identity);
    await c.query(
      `INSERT INTO content_votes(user_id,entity_id,vote) VALUES($1,$2,$3) ON CONFLICT(user_id,entity_id) DO UPDATE SET vote=EXCLUDED.vote,updated_at=now()`,
      [userId, id, choice],
    );
    if (choice === "not_slop") {
      await c.query(
        "DELETE FROM content_vote_signals WHERE user_id=$1 AND entity_id=$2",
        [userId, id],
      );
      await c.query(
        "DELETE FROM content_vote_feedback WHERE user_id=$1 AND entity_id=$2",
        [userId, id],
      );
    }
  });
  return rating(videoId);
}
export async function details(
  videoId: string | ContentIdentity,
  userId: string,
) {
  const { rows } = await pool.query(
    `SELECT COALESCE((SELECT json_agg(s.key ORDER BY s.key) FROM content_vote_signals vs JOIN slop_signals s ON s.id=vs.signal_id WHERE vs.user_id=$2 AND vs.entity_id=e.id),'[]') AS signals,COALESCE((SELECT other_text FROM content_vote_feedback f WHERE f.user_id=$2 AND f.entity_id=e.id),'') AS "otherText" FROM entities e WHERE e.entity_type=$3 AND e.canonical_url=$1`,
    [
      contentIdentity(videoId).canonicalUrl,
      userId,
      contentIdentity(videoId).entityType,
    ],
  );
  return rows[0] ?? { signals: [], otherText: "" };
}
export async function saveDetails(
  videoId: string | ContentIdentity,
  userId: string,
  input: Details,
) {
  const identity = contentIdentity(videoId);
  const data = detailsSchema.parse(input);
  if (
    !data.signals.every((key) =>
      signalsFor(
        identity.entityType as "youtube_video" | "linkedin_post",
      ).includes(key),
    )
  )
    throw new HttpError(400, "Unsupported reason for this platform.");
  if (data.sourceUrl && !data.signals.includes("copied_or_repackaged"))
    throw new HttpError(
      400,
      "Select copied or repackaged before adding a source.",
    );
  if (identity.entityType === "linkedin_post" && data.sourceUrl)
    throw new HttpError(422, "LinkedIn source reporting is not available.");
  const source = data.sourceUrl ? await resolveSource(data.sourceUrl) : null;
  if (
    source?.entityType === identity.entityType &&
    source.canonicalUrl === identity.canonicalUrl
  )
    throw new HttpError(400, "The source must be a different video.");
  await transaction(async (c) => {
    // Same lock order as vote(): entity first, then vote. Locks serialize concurrent saves and vote changes.
    const id = await entity(c, identity);
    const { rows } = await c.query(
      "SELECT vote FROM content_votes WHERE user_id=$1 AND entity_id=$2 FOR UPDATE",
      [userId, id],
    );
    if (rows[0]?.vote !== "slop")
      throw new HttpError(409, "Mark this content Slop before adding reasons.");
    await c.query(
      "DELETE FROM content_vote_signals WHERE user_id=$1 AND entity_id=$2",
      [userId, id],
    );
    await c.query(
      `INSERT INTO content_vote_signals(user_id,entity_id,signal_id) SELECT $1,$2,id FROM slop_signals WHERE key=ANY($3::text[])`,
      [userId, id, data.signals],
    );
    if (data.otherText)
      await c.query(
        `INSERT INTO content_vote_feedback(user_id,entity_id,other_text) VALUES($1,$2,$3) ON CONFLICT(user_id,entity_id) DO UPDATE SET other_text=EXCLUDED.other_text,updated_at=now()`,
        [userId, id, data.otherText],
      );
    else
      await c.query(
        "DELETE FROM content_vote_feedback WHERE user_id=$1 AND entity_id=$2",
        [userId, id],
      );
    if (source) {
      const sourceId = await entity(c, source);
      await c.query(
        `INSERT INTO content_reports(reporter_user_id,entity_id,source_entity_id,report_type) VALUES($1,$2,$3,'copied_from') ON CONFLICT DO NOTHING`,
        [userId, id, sourceId],
      );
    }
  });
  return details(videoId, userId);
}
