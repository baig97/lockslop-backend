import { config } from "dotenv";
config({ path: ".env.local", quiet: true });
import assert from "node:assert/strict";
const { fetchYouTubePayload, generationPool } =
  await import("../lib/ai-signals");
const { pool } = await import("../lib/db");
const original = globalThis.fetch;
const key = process.env.YOUTUBE_DATA_API_KEY;
process.env.YOUTUBE_DATA_API_KEY = "test-key";
const video = {
  id: "abcdefghijk",
  snippet: {
    title: "A useful explanation",
    description: "Useful details",
    publishedAt: "2026-01-01T00:00:00Z",
  },
  contentDetails: { duration: "PT3M" },
};
const thread = {
  id: "thread",
  snippet: {
    videoId: video.id,
    topLevelComment: {
      snippet: {
        textDisplay: "Repeated points",
        publishedAt: "2026-01-02T00:00:00Z",
        updatedAt: "2026-01-02T00:00:00Z",
        authorDisplayName: "Raw only",
      },
    },
  },
};
try {
  let calls = 0;
  let commentResponse = () =>
    Response.json({ items: [thread], nextPageToken: "never-follow" });
  globalThis.fetch = async (url, init) => {
    calls++;
    const parsed = new URL(String(url));
    assert.equal(parsed.searchParams.get("key"), "test-key");
    assert.equal(init?.cache, "no-store");
    if (parsed.pathname.endsWith("/videos"))
      return Response.json({ items: [video] });
    assert(parsed.pathname.endsWith("/commentThreads"));
    assert.equal(parsed.searchParams.get("videoId"), video.id);
    assert.equal(parsed.searchParams.get("part"), "snippet");
    assert.equal(parsed.searchParams.get("maxResults"), "10");
    assert.equal(parsed.searchParams.get("order"), "relevance");
    assert.equal(parsed.searchParams.get("textFormat"), "plainText");
    assert.equal(parsed.searchParams.get("pageToken"), null);
    return commentResponse();
  };
  const result = (await fetchYouTubePayload(video.id)) as any;
  assert.equal(calls, 2);
  assert.deepEqual(result.commentThreads.items, [thread]);
  assert.equal(result.commentThreads.status, "ready");
  assert(!("nextPageToken" in result.commentThreads));
  commentResponse = () => Response.json({ items: [] });
  assert.equal(
    ((await fetchYouTubePayload(video.id)) as any).commentThreads.status,
    "ready",
  );
  commentResponse = () =>
    Response.json(
      { error: { errors: [{ reason: "commentsDisabled" }] } },
      { status: 403 },
    );
  assert.equal(
    ((await fetchYouTubePayload(video.id)) as any).commentThreads.status,
    "disabled",
  );
  for (const response of [
    () => Response.json({ error: {} }, { status: 503 }),
    () => Response.json({ error: {} }, { status: 403 }),
    () =>
      Response.json({
        items: [
          { ...thread, snippet: { ...thread.snippet, videoId: "wrong" } },
        ],
      }),
    () => Response.json({ items: [null] }),
    () => {
      throw new DOMException("Timeout", "TimeoutError");
    },
  ]) {
    commentResponse = response;
    const fallback = (await fetchYouTubePayload(video.id)) as any;
    assert.equal(fallback.id, video.id);
    assert.deepEqual(fallback.commentThreads, {
      status: "unavailable",
      order: "relevance",
      items: [],
    });
  }
  console.log(
    "PASS: canonical video + ten relevance-ranked raw threads, no pagination, empty/disabled/malformed/wrong-video/failed/timeout comment fallbacks.",
  );
} finally {
  globalThis.fetch = original;
  if (key === undefined) delete process.env.YOUTUBE_DATA_API_KEY;
  else process.env.YOUTUBE_DATA_API_KEY = key;
  await generationPool.end();
  await pool.end();
}
