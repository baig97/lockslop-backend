import { config } from "dotenv";
config({ path: ".env.local", quiet: true });
import assert from "node:assert/strict";
import { randomUUID, randomBytes, createHash } from "node:crypto";
const { pool } = await import("../lib/db");
const base = process.env.BETTER_AUTH_URL || "http://localhost:3000";
if (!["localhost", "127.0.0.1"].includes(new URL(base).hostname))
  throw Error("Integration tests require a local server.");
const users = [randomUUID(), randomUUID()];
const tokens = [
  randomBytes(32).toString("hex"),
  randomBytes(32).toString("hex"),
];
const ids = [
  randomBytes(9).toString("base64url").slice(0, 11),
  randomBytes(9).toString("base64url").slice(0, 11),
];
const path = `/api/v1/youtube/videos/${ids[0]}`;
const { sanitizeContent, hashContent } =
  await import("../lib/contracts/content");
const { evaluationFixtures, fixtureContent } =
  await import("./evaluation-fixtures");
const input = sanitizeContent(
  "youtube_video",
  fixtureContent(evaluationFixtures[0]),
);
const hash = hashContent("youtube_video", input);
const identity = {
  entityType: "youtube_video",
  externalId: ids[0],
  contentHash: hash,
};
async function publicRating() {
  const data = await (
    await req(
      "/api/v1/content/overviews:batch",
      "POST",
      { entities: [identity] },
      null,
    )
  ).json();
  assert.equal(data.results[0].status, "success");
  const c = data.results[0].overview.community;
  return {
    targetId: ids[0],
    slopVotes: c.slopVotes,
    notSlopVotes: c.notSlopVotes,
    signalCounts: c.signals,
  };
}
const sha = (s: string) => createHash("sha256").update(s).digest("base64url");
async function req(
  p: string,
  method = "GET",
  data?: unknown,
  token: string | null = tokens[0],
  expected = 200,
  headers: Record<string, string> = {},
) {
  const res = await fetch(base + p, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(data !== undefined ? { "Content-Type": "application/json" } : {}),
      ...headers,
    },
    ...(data !== undefined ? { body: JSON.stringify(data) } : {}),
    redirect: "manual",
  });
  assert.equal(
    res.status,
    expected,
    `${method} ${p}: ${await res.clone().text()}`,
  );
  return res;
}
const { issue, verifyOAuth } = await import("./oauth-test-helper");
const parentTokens = [...tokens];
try {
  for (let i = 0; i < 2; i++) {
    await pool.query("INSERT INTO auth.user(id,name,email) VALUES($1,$2,$3)", [
      users[i],
      "Integration Test",
      `${users[i]}@example.invalid`,
    ]);
    await pool.query(
      `INSERT INTO auth.session(token,user_id,expires_at,updated_at) VALUES($1,$2,now()+interval '1 hour',now())`,
      [tokens[i], users[i]],
    );
  }
  for (let i = 0; i < 2; i++)
    tokens[i] = (await issue(parentTokens[i])).tokens.access_token;
  const columns = await pool.query(
    `SELECT table_name,column_name,data_type FROM information_schema.columns WHERE table_schema IN ('auth','public') AND (column_name='id' OR column_name IN ('user_id','reporter_user_id','entity_id','source_entity_id','signal_id','session_id'))`,
  );
  assert(
    columns.rows.every((r) => r.data_type === "uuid"),
    "Every primary and relational ID is UUID",
  );
  await req(
    "/api/v1/content/ai-signals:derive",
    "POST",
    { entities: [] },
    null,
    401,
  );
  for (const suffix of ["overview", "rating", "my-vote"])
    await req(path + "/" + suffix, "GET", undefined, null, 404);
  await req(
    path + "/my-vote",
    "PUT",
    { vote: "slop", userId: users[1] },
    tokens[0],
    400,
  );
  await req(path + "/my-vote", "PUT", { vote: "slop" }, tokens[0], 403, {
    Origin: "https://evil.example",
  });
  await req(
    "/api/v1/youtube/channels/UCabc/my-vote",
    "PUT",
    { vote: "slop" },
    tokens[0],
    404,
  );
  await req(
    path + "/my-vote/details",
    "PUT",
    { signals: ["repetitive"], otherText: "" },
    tokens[0],
    409,
  );
  await req(path + "/my-vote", "PUT", { vote: "slop" });
  await req(path + "/my-vote", "PUT", { vote: "slop" });
  await req(path + "/my-vote", "PUT", { vote: "not_slop" }, tokens[1]);
  assert.deepEqual(await publicRating(), {
    targetId: ids[0],
    slopVotes: 1,
    notSlopVotes: 1,
    signalCounts: [],
  });
  const reasons = {
    signals: ["copied_or_repackaged", "clickbait"],
    otherText: "Test private feedback",
    sourceUrl: `https://youtu.be/${ids[1]}?t=12`,
  };
  await req(path + "/my-vote/details", "PUT", reasons);
  const summary = await publicRating();
  assert.deepEqual(summary.signalCounts, [
    { key: "clickbait", count: 1 },
    { key: "copied_or_repackaged", count: 1 },
  ]);
  assert.equal(
    summary.slopVotes,
    1,
    "Signal percentages use Slop voters, not all votes or selections",
  );
  assert(
    !JSON.stringify(summary).includes(reasons.otherText),
    "Public summaries never expose private feedback",
  );
  await req(path + "/my-vote/details", "PUT", {
    ...reasons,
    sourceUrl: `https://www.youtube.com/watch?v=${ids[1]}&t=3`,
  });
  assert.equal(
    (
      await pool.query(
        "SELECT * FROM content_reports WHERE reporter_user_id=$1",
        [users[0]],
      )
    ).rowCount,
    1,
  );
  assert.deepEqual(
    await (
      await req(path + "/my-vote/details", "GET", undefined, tokens[1])
    ).json(),
    { signals: [], otherText: "" },
  );
  await req(
    path + "/my-vote/details",
    "PUT",
    { ...reasons, sourceUrl: `https://youtu.be/${ids[0]}` },
    tokens[0],
    400,
  );
  assert.equal(
    (await (await req(path + "/my-vote/details")).json()).otherText,
    reasons.otherText,
    "invalid source does not partially overwrite details",
  );
  await req(
    path + "/my-vote/details",
    "PUT",
    { ...reasons, signals: ["unknown"] },
    tokens[0],
    400,
  );
  await req(
    path + "/my-vote/details",
    "PUT",
    { ...reasons, otherText: "x".repeat(501) },
    tokens[0],
    400,
  );
  await req(
    path + "/my-vote/details",
    "PUT",
    { ...reasons, otherText: "x".repeat(9000) },
    tokens[0],
    413,
  );
  // Both request orders must serialize without leaving reasons on a Not slop vote.
  for (let i = 0; i < 3; i++) {
    await req(path + "/my-vote", "PUT", { vote: "slop" });
    const outcomes = await Promise.all([
      fetch(base + path + "/my-vote/details", {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${tokens[0]}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(reasons),
      }),
      req(path + "/my-vote", "PUT", { vote: "not_slop" }),
    ]);
    assert([200, 409].includes(outcomes[0].status));
    assert.deepEqual(await (await req(path + "/my-vote/details")).json(), {
      signals: [],
      otherText: "",
    });
    assert.deepEqual(
      (await publicRating()).signalCounts,
      [],
      "Changing to Not slop removes public signal counts",
    );
  }
  assert.equal(
    (
      await pool.query(
        "SELECT * FROM content_reports WHERE reporter_user_id=$1",
        [users[0]],
      )
    ).rowCount,
    1,
    "reports survive vote changes",
  );
  const extensionId = process.env.EXTENSION_IDS!.split(",")[0];
  const origin = `chrome-extension://${extensionId}`;
  await req(path + "/rating", "OPTIONS", undefined, null, 204, {
    Origin: origin,
  });

  const mixed = {
    entities: [
      identity,
      {
        entityType: "linkedin_post",
        url: `https://www.linkedin.com/posts/test-activity-${Date.now()}-abc/`,
        contentHash: hash,
      },
      { ...identity, url: "https://www.youtube.com/watch?v=" + ids[0] },
    ],
  };
  await req(
    "/api/v1/content/overviews:batch",
    "POST",
    { items: [identity] },
    null,
    400,
  );
  await req(
    "/api/v1/content/overviews:batch",
    "POST",
    { entities: [identity], content: input },
    null,
    400,
  );
  await req(
    "/api/v1/content/overviews:batch",
    "POST",
    { entities: new Array(10).fill(identity) },
    null,
  );
  await req(
    "/api/v1/content/overviews:batch",
    "POST",
    { entities: [identity], padding: "x".repeat(33000) },
    null,
    413,
  );
  let response = await (
    await req("/api/v1/content/overviews:batch", "POST", mixed, null)
  ).json();
  assert.equal(response.results[0].status, "success");
  assert.equal(response.results[1].status, "success");
  assert.equal(response.results[2].status, "error");
  assert.equal(response.results[0].overview.ai.status, "needs_input");
  const linkedId = response.results[1].overview.entity.id;
  await req(
    "/api/v1/content/overviews:batch",
    "POST",
    { entities: new Array(11).fill(identity) },
    null,
    400,
  );
  await req(
    "/api/v1/content/overviews:batch",
    "POST",
    { entities: [] },
    null,
    400,
  );
  await req("/api/v1/content/overviews:batch", "GET", undefined, null, 405);
  await req(
    "/api/v1/content/overviews:batch",
    "POST",
    { entities: [identity] },
    "invalid",
    401,
  );
  const readToken = (
    await issue(parentTokens[0], { scope: "openid slop:read" })
  ).tokens.access_token;
  await req(
    "/api/v1/content/overviews:batch",
    "POST",
    { entities: [identity] },
    readToken,
  );
  await req(
    "/api/v1/content/ai-signals:derive",
    "POST",
    { entities: [{ ...identity, content: input }] },
    readToken,
    403,
  );
  // Invoke the real route handler with a stubbed TypeSafe transport, never a production inference stub.
  const { POST } = await import("../app/api/v1/[...path]/route");
  const { JEV_MODEL } = await import("../lib/ai/config");
  const { aiSignalKeys, batchOverviewSchema } =
    await import("../lib/contracts/overview");
  const originalFetch = globalThis.fetch,
    oldKey = process.env.TYPESAFE_API_KEY;
  process.env.TYPESAFE_API_KEY = "test-key";
  let providerCalls = 0;
  globalThis.fetch = async (url, init) => {
    if (String(url) === "https://api.typesafe.ai/v1/systemone") {
      providerCalls++;
      const body = JSON.parse(String(init?.body));
      assert(body.state.includes("untrusted_rendered_content_json"));
      return Response.json({
        model: JEV_MODEL,
        answers: Object.fromEntries(
          Object.keys(body.questions).map((key) => [
            key,
            { type: "score", score: 1.5 },
          ]),
        ),
        usage: { input_tokens: 10, output_tokens: 5 },
      });
    }
    if (/googleapis|linkedin\.com/.test(new URL(String(url)).hostname))
      throw Error("Unexpected platform request");
    return originalFetch(url, init);
  };
  const call = async (items: unknown[], derive = false) => {
    const endpoint = derive ? "ai-signals:derive" : "overviews:batch";
    const result = await POST(
      new Request(base + "/api/v1/content/" + endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + tokens[0],
        },
        body: JSON.stringify({ entities: items }),
      }),
    );
    assert.equal(result.status, 200);
    return batchOverviewSchema.parse(await result.json());
  };
  try {
    response = await call([identity]);
    assert.equal(response.results[0].overview.ai.status, "needs_input");
    assert.equal(providerCalls, 0);
    const post = sanitizeContent("linkedin_post", {
      schemaVersion: 2,
      text: input.description,
      publishedAt: input.publishedAt,
    });
    const postItem = {
      entityType: "linkedin_post",
      url: (mixed.entities[1] as { url: string }).url,
      contentHash: hashContent("linkedin_post", post),
    };
    const derived = await call(
      [
        { ...identity, content: input },
        { ...postItem, content: post },
        {
          ...identity,
          content: { ...input, description: "Wrong hash" },
        },
      ],
      true,
    );
    assert.equal(derived.results[0].status, "success");
    assert.equal(derived.results[1].status, "success");
    assert.equal(derived.results[2].status, "error");
    for (const row of derived.results.slice(0, 2)) {
      assert.equal(row.status, "success");
      if (row.status === "success")
        assert.equal(row.overview.ai.status, "ready");
      if (row.status === "success" && row.overview.ai.status === "ready")
        assert.equal(
          row.overview.ai.signals.length,
          row.overview.entity.type === "linkedin_post" ? 7 : 5,
        );
    }
    assert.equal(providerCalls, 2);
    const postIdentity = { entityType: "linkedin_post", url: postItem.url };
    await req("/api/v1/content/my-vote", "PUT", {
      entity: postIdentity,
      vote: "slop",
    });
    await req("/api/v1/content/my-vote/details", "PUT", {
      entity: postIdentity,
      details: {
        signals: ["engagement_bait", "incoherent_reasoning"],
        otherText: "Unnecessary interaction requests",
      },
    });
    const postDetails = await (
      await req(
        "/api/v1/content/my-vote/details?" + new URLSearchParams(postIdentity),
      )
    ).json();
    assert.deepEqual(postDetails.signals, [
      "engagement_bait",
      "incoherent_reasoning",
    ]);
    await req(
      "/api/v1/content/my-vote/details",
      "PUT",
      {
        entity: { entityType: "youtube_video", url: `https://www.youtube.com/watch?v=${ids[0]}` },
        details: { signals: ["engagement_bait"], otherText: "" },
      },
      tokens[0],
      400,
    );
    await req(
      "/api/v1/content/my-vote/details",
      "PUT",
      {
        entity: postIdentity,
        details: {
          signals: ["copied_or_repackaged"],
          otherText: "",
          sourceUrl: `https://youtu.be/${ids[1]}`,
        },
      },
      tokens[0],
      422,
    );
    await req("/api/v1/content/my-vote", "PUT", {
      entity: postIdentity,
      vote: "not_slop",
    });
    const clearedPost = await (
      await req(
        "/api/v1/content/my-vote/details?" + new URLSearchParams(postIdentity),
      )
    ).json();
    assert.deepEqual(clearedPost.signals, []);
    assert.equal(clearedPost.otherText, "");
    await call([{ ...identity, content: input }], true);
    await call([identity, postItem]);
    assert.equal(providerCalls, 2);
    const unsupported = sanitizeContent(
      "youtube_video",
      fixtureContent(evaluationFixtures[6]),
    );
    const nonEnglish = {
      ...identity,
      contentHash: hashContent("youtube_video", unsupported),
      content: unsupported,
    };
    const gated = await call([nonEnglish], true);
    assert.equal(gated.results[0].status, "success");
    if (gated.results[0].status === "success")
      assert.equal(gated.results[0].overview.ai.status, "unsupported_language");
    assert.equal(providerCalls, 2);
    const failedInput = structuredClone(input);
    failedInput.description +=
      " Further detailed explanation of brake alignment.";
    const failedItem = {
      ...identity,
      contentHash: hashContent("youtube_video", failedInput),
    };
    delete process.env.TYPESAFE_API_KEY;
    const providerFailure = await call(
      [{ ...failedItem, content: failedInput }],
      true,
    );
    assert.equal(providerFailure.results[0].status, "success");
    if (providerFailure.results[0].status === "success") {
      assert.equal(
        providerFailure.results[0].overview.ai.status,
        "unavailable",
      );
      assert.equal(
        providerFailure.results[0].overview.community.notSlopVotes,
        2,
      );
      assert.equal(
        providerFailure.results[0].overview.viewer.status,
        "authenticated",
      );
    }
    assert.equal(providerCalls, 2);
    const failedLookup = await call([failedItem]);
    assert.equal(failedLookup.results[0].status, "success");
    if (failedLookup.results[0].status === "success")
      assert.equal(failedLookup.results[0].overview.ai.status, "unavailable");
    assert.equal(providerCalls, 2);
    process.env.TYPESAFE_API_KEY = "test-key";
    const linkedInput = await pool.query(
      "SELECT a.input,a.user_id FROM content_analyses a WHERE entity_id=$1",
      [linkedId],
    );
    assert.equal(linkedInput.rows[0].user_id, users[0]);
  } finally {
    globalThis.fetch = originalFetch;
    if (oldKey === undefined) delete process.env.TYPESAFE_API_KEY;
    else process.env.TYPESAFE_API_KEY = oldKey;
    await pool.query("DELETE FROM entities WHERE id=$1", [linkedId]);
  }

  await verifyOAuth(parentTokens[0], users[0], pool);
  console.log(
    "PASS: batch lookup/derivation, mixed platforms, hashes, model caching, language fallback, retired routes, read/write scopes, UUID schema, auth, capability boundaries, ownership, validation, vote upserts, atomic feedback, source dedupe, concurrent writes, CORS, PKCE, replay/expiry/revocation, OAuth Provider tokens.",
  );
} finally {
  await pool.query("DELETE FROM auth.user WHERE id=ANY($1::uuid[])", [users]);
  await pool.query("DELETE FROM entities WHERE canonical_url=ANY($1::text[])", [
    ids.map((id) => `https://www.youtube.com/watch?v=${id}`),
  ]);
  await pool.query(
    "DELETE FROM auth.api_rate_limits WHERE key=ANY($1::text[])",
    [
      users.map((id) =>
        createHash("sha256").update(`write:${id}`).digest("hex"),
      ),
    ],
  );
  const { generationPool } = await import("../lib/ai-signals");
  await generationPool.end();
  await pool.end();
}
