import { config } from "dotenv";
config({ path: ".env.local", quiet: true });
import assert from "node:assert/strict";
const {
  fetchYouTubePayload,
  mapYouTubePayload,
  deriveAiSignals,
  generationPool,
} = await import("../lib/ai-signals");
const { pool } = await import("../lib/db");
const { checkMetadataLanguage } = await import("../lib/ai/language");
try {
  const id = process.env.TEST_YOUTUBE_VIDEO_ID ?? "aircAruvnKk";
  const raw = await fetchYouTubePayload(id);
  const input = mapYouTubePayload(raw, id);
  assert.equal(
    input.comments.status,
    "ready",
    "Live comment request must succeed for this fixture",
  );
  assert(input.comments.items.length > 0 && input.comments.items.length <= 10);
  assert.equal(
    checkMetadataLanguage(input),
    null,
    "Choose an English-metadata fixture",
  );
  const scores = await deriveAiSignals(input);
  assert.equal(scores.length, 5);
  assert(
    scores.every(
      (signal) =>
        Number.isFinite(signal.score) && signal.score >= 0 && signal.score <= 1,
    ),
  );
  console.log(
    JSON.stringify({
      status: "PASS",
      liveComments: input.comments.items.length,
      scores,
      storedDataChanged: false,
    }),
  );
} finally {
  await generationPool.end();
  await pool.end();
}
