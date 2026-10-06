import { config } from "dotenv";
config({ path: ".env.local", quiet: true });
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
const { pool } = await import("../lib/db");
const {
  ensureAiSignals,
  generationPool,
  fetchYouTubePayload,
  mapYouTubePayload,
  deriveAiSignals,
  GENERATOR_VERSION,
} = await import("../lib/ai-signals");
const { aiSignalKeys, overviewSchema } =
  await import("../lib/contracts/overview");
const { overview } = await import("../lib/overview");
const ids: string[] = [];
const payload = (id: string) => ({
  kind: "youtube#video",
  etag: "resource-etag",
  id,
  snippet: {
    title: "Test",
    description:
      "This video explains how bicycle brakes work with a practical demonstration of cable tension, pad alignment and stopping distances.",
    channelId: "UCtest",
    publishedAt: "2026-01-01T00:00:00Z",
    tags: ["retained"],
  },
  contentDetails: { duration: "PT3M", definition: "hd" },
  extra: { retained: true },
  commentThreads: {
    status: "ready",
    order: "relevance",
    items: [
      {
        kind: "youtube#commentThread",
        id: "raw-comment-id",
        snippet: {
          videoId: id,
          topLevelComment: {
            snippet: {
              textDisplay: "The practical example was helpful.",
              authorDisplayName: "raw-viewer",
              publishedAt: "2026-01-02T00:00:00Z",
              updatedAt: "2026-01-02T00:00:00Z",
            },
          },
        },
      },
    ],
  },
});
async function fixture() {
  const videoId = randomBytes(9).toString("base64url").slice(0, 11);
  const { rows } = await pool.query(
    "INSERT INTO entities(entity_type,external_id,canonical_url) VALUES('youtube_video',$1,$2) RETURNING id",
    [videoId, `https://www.youtube.com/watch?v=${videoId}`],
  );
  ids.push(rows[0].id);
  return { id: rows[0].id, videoId };
}
let fetched = 0,
  derived = 0;
const deps = {
  fetchPayload: async (id: string) => {
    fetched++;
    return payload(id);
  },
  derive: async (input: ReturnType<typeof mapYouTubePayload>) => {
    assert.equal(
      input.comments.items[0]?.text,
      "The practical example was helpful.",
    );
    derived++;
    return aiSignalKeys.map((key, i) => ({ key, score: i / 5 }));
  },
};
try {
  // Exercise the actual get-by-ID pipeline without spending provider quota.
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.YOUTUBE_DATA_API_KEY;
  process.env.YOUTUBE_DATA_API_KEY = originalKey || "test-key";
  try {
    const videoId = "abcdefghijk",
      resource = payload(videoId);
    globalThis.fetch = async (url) => {
      if (String(url).includes("/commentThreads?"))
        return Response.json({ items: [] });
      return Response.json({
        kind: "youtube#videoListResponse",
        etag: "list-etag",
        pageInfo: { totalResults: 2 },
        items: [resource, payload("lmnopqrstuv")],
        envelopeOnly: true,
      });
    };
    assert.deepEqual(
      await fetchYouTubePayload(videoId),
      {
        ...resource,
        commentThreads: { status: "ready", order: "relevance", items: [] },
      },
      "Only the first complete raw resource and its comments are returned",
    );
    globalThis.fetch = async () => Response.json({ items: [] });
    await assert.rejects(fetchYouTubePayload(videoId));
    globalThis.fetch = async () =>
      Response.json({ items: [payload("lmnopqrstuv"), resource] });
    await assert.rejects(
      fetchYouTubePayload(videoId),
      /does not match/,
      "Do not attach a mismatched first item to an entity",
    );
    assert.throws(() => mapYouTubePayload({ items: [resource] }, videoId));
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.YOUTUBE_DATA_API_KEY;
    else process.env.YOUTUBE_DATA_API_KEY = originalKey;
  }
  const a = await fixture();
  assert.deepEqual(mapYouTubePayload(payload(a.videoId), a.videoId), {
    title: "Test",
    description:
      "This video explains how bicycle brakes work with a practical demonstration of cable tension, pad alignment and stopping distances.",
    duration: "PT3M",
    durationSeconds: 180,
    publishedAt: "2026-01-01T00:00:00Z",
    tags: ["retained"],
    defaultLanguage: null,
    defaultAudioLanguage: null,
    liveBroadcastContent: null,
    comments: {
      status: "ready",
      order: "relevance",
      items: [
        {
          text: "The practical example was helpful.",
          publishedAt: "2026-01-02T00:00:00Z",
          updatedAt: "2026-01-02T00:00:00Z",
        },
      ],
    },
  });
  const first = await ensureAiSignals(a.id, a.videoId, deps);
  assert.equal(first.status, "ready");
  assert.equal(fetched, 1);
  assert.equal(derived, 1);
  assert.deepEqual(await ensureAiSignals(a.id, a.videoId, deps), first);
  assert.equal(fetched, 1);
  assert.equal(derived, 1);
  let saved = (
    await pool.query("SELECT * FROM content_payloads WHERE entity_id=$1", [
      a.id,
    ])
  ).rows[0];
  assert.deepEqual(
    saved.payload,
    payload(a.videoId),
    "Only the full entity resource is persisted",
  );
  assert(!("items" in saved.payload));
  assert(!("pageInfo" in saved.payload));
  assert(saved.payload.snippet.tags.includes("retained"));
  const oldRevision = saved.revision,
    created = saved.created_at.toISOString();
  await pool.query("DELETE FROM ai_content_signals WHERE entity_id=$1", [a.id]);
  assert.equal((await ensureAiSignals(a.id, a.videoId, deps)).status, "ready");
  assert.equal(fetched, 1);
  assert.equal(derived, 2);
  await pool.query(
    "UPDATE ai_content_signals SET generator_version='1' WHERE entity_id=$1",
    [a.id],
  );
  assert.equal((await ensureAiSignals(a.id, a.videoId, deps)).status, "ready");
  assert.equal(
    derived,
    2,
    "A fresh score set is reused across generator versions",
  );
  await pool.query(
    "UPDATE ai_content_signals SET updated_at=now()-interval '1 month'-interval '1 second' WHERE entity_id=$1",
    [a.id],
  );
  assert.equal((await ensureAiSignals(a.id, a.videoId, deps)).status, "ready");
  assert.equal(derived, 3, "Expired scores regenerate during the request");
  assert.equal(fetched, 1);
  await pool.query(
    "UPDATE content_payloads SET status='stale' WHERE entity_id=$1",
    [a.id],
  );
  assert.equal((await ensureAiSignals(a.id, a.videoId, deps)).status, "ready");
  assert.equal(fetched, 2);
  assert.equal(derived, 4);
  saved = (
    await pool.query("SELECT * FROM content_payloads WHERE entity_id=$1", [
      a.id,
    ])
  ).rows[0];
  assert.notEqual(saved.revision, oldRevision);
  assert.equal(saved.created_at.toISOString(), created);
  const b = await fixture();
  const before = fetched,
    beforeD = derived;
  const results = await Promise.all(
    Array.from({ length: 3 }, () => ensureAiSignals(b.id, b.videoId, deps)),
  );
  assert(results.every((r) => r.status === "ready"));
  assert.equal(fetched, before + 1);
  assert.equal(derived, beforeD + 1);
  assert.deepEqual(results[0], results[1]);
  // TTL is based on generation/update time; all five rows must be fresh.
  const ttl = await fixture();
  await ensureAiSignals(ttl.id, ttl.videoId, deps);
  const ttlFetched = fetched,
    ttlDerived = derived;
  await pool.query(
    "UPDATE ai_content_signals SET updated_at=now()-interval '1 month'+interval '1 minute' WHERE entity_id=$1",
    [ttl.id],
  );
  assert.equal(
    (await ensureAiSignals(ttl.id, ttl.videoId, deps)).status,
    "ready",
  );
  assert.equal(
    derived,
    ttlDerived,
    "Just-under-one-month results remain cached",
  );
  await pool.query(
    "UPDATE ai_content_signals SET updated_at=now()-interval '1 month'-interval '1 second' WHERE entity_id=$1 AND signal_key=$2",
    [ttl.id, aiSignalKeys[0]],
  );
  const refreshed = await Promise.all(
    Array.from({ length: 3 }, () => ensureAiSignals(ttl.id, ttl.videoId, deps)),
  );
  assert(refreshed.every((result) => result.status === "ready"));
  assert.equal(
    derived,
    ttlDerived + 1,
    "One expired score triggers one atomic set refresh across concurrent requests",
  );
  assert.equal(
    fetched,
    ttlFetched,
    "TTL expiry reuses the stored ready payload",
  );
  assert.deepEqual(refreshed[0], refreshed[1]);

  const languageFixture = await fixture();
  const languageDeps = {
    fetchPayload: async (id: string) => ({
      ...payload(id),
      snippet: {
        ...payload(id).snippet,
        title: "سائیکل کے بریک کیسے کام کرتے ہیں",
        description:
          "اس ویڈیو میں کیبل کی کھنچاؤ اور بریک پیڈ کی سیدھ کی عملی وضاحت ہے۔ پہلے کیبل کو چیک کریں، پھر پیڈ کو درست کریں۔ ہم دو طریقوں کا موازنہ اور ان کی حدود بتاتے ہیں۔",
      },
    }),
    derive: async () => {
      throw Error("Non-English metadata must never reach inference");
    },
  };
  const nonEnglish = await ensureAiSignals(
    languageFixture.id,
    languageFixture.videoId,
    languageDeps,
  );
  assert.equal(nonEnglish.status, "unsupported_language");
  assert.deepEqual(
    await ensureAiSignals(languageFixture.id, languageFixture.videoId, {
      ...languageDeps,
      fetchPayload: async () => {
        throw Error("Stored language payload must be reused");
      },
    }),
    nonEnglish,
  );
  assert.equal(
    (
      await pool.query("SELECT * FROM ai_content_signals WHERE entity_id=$1", [
        languageFixture.id,
      ])
    ).rowCount,
    0,
  );
  const languageOverview = overviewSchema.parse(
    await overview(languageFixture.videoId),
  );
  assert.equal(languageOverview.ai.status, "unsupported_language");
  assert.equal(languageOverview.community.slopVotes, 0);
  const languageHttp = await fetch(
    `${process.env.BETTER_AUTH_URL}/api/v1/youtube/videos/${languageFixture.videoId}/overview`,
  );
  assert.equal(languageHttp.status, 200);
  assert.equal(
    overviewSchema.parse(await languageHttp.json()).ai.status,
    "unsupported_language",
  );
  const unknownFixture = await fixture();
  assert.deepEqual(
    await ensureAiSignals(unknownFixture.id, unknownFixture.videoId, {
      ...languageDeps,
      fetchPayload: async (id: string) => ({
        ...payload(id),
        snippet: { ...payload(id).snippet, title: "Notes", description: "" },
      }),
    }),
    { status: "unsupported_language", detectedLanguage: "und" },
  );
  // Suppress even an existing fresh score set when metadata fails the language gate.
  await pool.query(
    "INSERT INTO ai_content_signals(entity_id,signal_key,score,payload_revision,generator_version) SELECT $1,key,.8,p.revision,$2 FROM content_payloads p CROSS JOIN unnest($3::text[]) as key WHERE p.entity_id=$1",
    [languageFixture.id, GENERATOR_VERSION, aiSignalKeys],
  );
  assert.equal(
    (
      await ensureAiSignals(
        languageFixture.id,
        languageFixture.videoId,
        languageDeps,
      )
    ).status,
    "unsupported_language",
  );
  const c = await fixture();
  assert.equal(
    (
      await ensureAiSignals(c.id, c.videoId, {
        ...deps,
        derive: async () => aiSignalKeys.map((key) => ({ key, score: 2 })),
      })
    ).status,
    "unavailable",
  );
  assert.equal(
    (
      await pool.query("SELECT * FROM content_payloads WHERE entity_id=$1", [
        c.id,
      ])
    ).rowCount,
    1,
  );
  assert.equal(
    (
      await pool.query("SELECT * FROM ai_content_signals WHERE entity_id=$1", [
        c.id,
      ])
    ).rowCount,
    0,
  );
  await assert.rejects(
    pool.query("UPDATE ai_content_signals SET score=$1 WHERE entity_id=$2", [
      2,
      a.id,
    ]),
  );
  await assert.rejects(
    pool.query("UPDATE ai_content_signals SET score=$1 WHERE entity_id=$2", [
      "NaN",
      a.id,
    ]),
  );
  const d = await fixture();
  assert.equal(
    (
      await ensureAiSignals(d.id, d.videoId, {
        ...deps,
        fetchPayload: async () => {
          throw Error("quota");
        },
      })
    ).status,
    "unavailable",
  );
  // Test the real mapper/context/runner composition, stubbing only HTTP transport.
  const e = await fixture();
  const actualFetch = globalThis.fetch;
  const actualKey = process.env.TYPESAFE_API_KEY;
  let modelCalls = 0;
  process.env.TYPESAFE_API_KEY = "test-key";
  try {
    globalThis.fetch = async (url, init) => {
      assert.equal(url, "https://api.typesafe.ai/v1/systemone");
      modelCalls++;
      const body = JSON.parse(init?.body as string);
      assert.equal(Object.keys(body.questions).length, 5);
      assert(body.state.includes("untrusted_provider_metadata_json"));
      return Response.json({
        model: body.model,
        answers: Object.fromEntries(
          aiSignalKeys.map((key) => [
            key,
            { type: "score", score: 3, confidence: 0 },
          ]),
        ),
        usage: { input_tokens: 100, output_tokens: 50 },
      });
    };
    const composed = await ensureAiSignals(e.id, e.videoId, {
      ...deps,
      derive: deriveAiSignals,
    });
    assert.equal(composed.status, "ready");
    if (composed.status === "ready")
      assert(composed.signals.every((s) => s.score === 0.75));
    const beforeRows = (
      await pool.query(
        "SELECT * FROM ai_content_signals WHERE entity_id=$1 ORDER BY signal_key",
        [e.id],
      )
    ).rows;
    assert(
      beforeRows.every((row) => row.generator_version === GENERATOR_VERSION),
    );
    await ensureAiSignals(e.id, e.videoId, {
      ...deps,
      derive: deriveAiSignals,
    });
    assert.equal(modelCalls, 1, "Warm cache never calls the runner");
    await pool.query(
      "UPDATE ai_content_signals SET generator_version=$2 WHERE entity_id=$1",
      [e.id, `youtube-metadata-v1:${GENERATOR_VERSION.split(":")[1]}`],
    );
    assert.equal(
      (
        await ensureAiSignals(e.id, e.videoId, {
          ...deps,
          derive: deriveAiSignals,
        })
      ).status,
      "ready",
    );
    assert.equal(
      modelCalls,
      1,
      "The previous formulation's fresh results remain usable",
    );
    await pool.query(
      "UPDATE ai_content_signals SET updated_at=now()-interval '1 month'-interval '1 second' WHERE entity_id=$1",
      [e.id],
    );
    const oldRows = (
      await pool.query(
        "SELECT * FROM ai_content_signals WHERE entity_id=$1 ORDER BY signal_key",
        [e.id],
      )
    ).rows;
    globalThis.fetch = async () =>
      Response.json({
        model: "jev-1.13.0",
        answers: { repetitive: { type: "score", score: 4 } },
        usage: { input_tokens: 10, output_tokens: 1 },
      });
    assert.equal(
      (
        await ensureAiSignals(e.id, e.videoId, {
          ...deps,
          derive: deriveAiSignals,
        })
      ).status,
      "unavailable",
    );
    assert.deepEqual(
      (
        await pool.query(
          "SELECT * FROM ai_content_signals WHERE entity_id=$1 ORDER BY signal_key",
          [e.id],
        )
      ).rows,
      oldRows,
      "Invalid Jev response never partially overwrites prior scores",
    );
    const f = await fixture();
    delete process.env.TYPESAFE_API_KEY;
    assert.equal(
      (
        await ensureAiSignals(f.id, f.videoId, {
          ...deps,
          derive: deriveAiSignals,
        })
      ).status,
      "unavailable",
    );
    assert.equal(
      (
        await pool.query(
          "SELECT * FROM ai_content_signals WHERE entity_id=$1",
          [f.id],
        )
      ).rowCount,
      0,
      "Missing credentials never produce random scores",
    );
    assert.equal(
      (
        await pool.query("SELECT * FROM content_payloads WHERE entity_id=$1", [
          f.id,
        ])
      ).rowCount,
      1,
      "Payload survives inference configuration failure",
    );
  } finally {
    globalThis.fetch = actualFetch;
    if (actualKey === undefined) delete process.env.TYPESAFE_API_KEY;
    else process.env.TYPESAFE_API_KEY = actualKey;
  }
  const o = overviewSchema.parse(await overview(a.videoId));
  assert.equal(o.ai.status, "ready");
  assert.equal(o.viewer.status, "anonymous");
  assert(!JSON.stringify(o).includes("description"));
  const response = await fetch(
    `${process.env.BETTER_AUTH_URL}/api/v1/youtube/videos/${a.videoId}/overview`,
  );
  assert.equal(response.status, 200);
  overviewSchema.parse(await response.json());
  const bad = await fetch(
    `${process.env.BETTER_AUTH_URL}/api/v1/youtube/videos/${a.videoId}/overview`,
    { headers: { Authorization: "Bearer invalid" } },
  );
  assert.equal(bad.status, 401);
  const unsupported = await fetch(
    `${process.env.BETTER_AUTH_URL}/api/v1/youtube/channels/${a.videoId}/overview`,
  );
  assert.equal(unsupported.status, 404);
  const fallback = await overview(d.videoId);
  assert.equal(fallback.ai.status, "unavailable");
  assert.equal(fallback.community.slopVotes, 0);
  console.log(
    "PASS: raw payload retention, mapping, cold/warm/partial caches, one-month expiry, cross-version reuse, stale payload refresh, English/undetermined language gating, concurrency, score constraints, atomic failure, typed HTTP overview, auth and capability boundaries, community fallback.",
  );
} finally {
  await pool.query("DELETE FROM entities WHERE id=ANY($1::uuid[])", [ids]);
  await generationPool.end();
  await pool.end();
}
