import { pool } from "./db";
import { rating, myVote, videoIdentity } from "./content";
import { ensureAiSignals } from "./ai-signals";
import { overviewSchema, type VideoOverviewDto } from "./contracts/overview";
export async function overview(
  videoId: string,
  userId?: string,
): Promise<VideoOverviewDto> {
  const identity = videoIdentity(videoId);
  const { rows } = await pool.query(
    `INSERT INTO entities(entity_type,external_id,canonical_url) VALUES('youtube_video',$1,$2) ON CONFLICT(entity_type,external_id) DO UPDATE SET canonical_url=EXCLUDED.canonical_url RETURNING id`,
    [videoId, identity.canonicalUrl],
  );
  const entityId = rows[0].id;
  const [community, personal, ai] = await Promise.all([
    rating(videoId),
    userId ? myVote(videoId, userId) : null,
    ensureAiSignals(entityId, videoId).catch(() => ({
      status: "unavailable" as const,
      retryable: true,
    })),
  ]);
  return overviewSchema.parse({
    entity: { id: entityId, type: "youtube_video", externalId: videoId },
    community: {
      slopVotes: community.slopVotes,
      notSlopVotes: community.notSlopVotes,
      signals: community.signalCounts,
    },
    viewer: personal
      ? { status: "authenticated", vote: personal.vote }
      : { status: "anonymous" },
    ai,
  });
}
