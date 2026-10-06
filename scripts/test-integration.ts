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
const {issue, verifyOAuth} = await import("./oauth-test-helper");
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
  for (let i=0;i<2;i++) tokens[i]=(await issue(parentTokens[i])).tokens.access_token;
  const columns = await pool.query(
    `SELECT table_name,column_name,data_type FROM information_schema.columns WHERE table_schema IN ('auth','public') AND (column_name='id' OR column_name IN ('user_id','reporter_user_id','entity_id','source_entity_id','signal_id','session_id'))`,
  );
  assert(
    columns.rows.every((r) => r.data_type === "uuid"),
    "Every primary and relational ID is UUID",
  );
  await req(path + "/my-vote", "GET", undefined, null, 401);
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
  assert.deepEqual(
    await (await req(path + "/rating", "GET", undefined, null)).json(),
    { targetId: ids[0], slopVotes: 1, notSlopVotes: 1, signalCounts: [] },
  );
  const reasons = {
    signals: ["copied_or_repackaged", "clickbait"],
    otherText: "Test private feedback",
    sourceUrl: `https://youtu.be/${ids[1]}?t=12`,
  };
  await req(path + "/my-vote/details", "PUT", reasons);
  const summary = await (await req(path + "/rating", "GET", undefined, null)).json();
  assert.deepEqual(summary.signalCounts, [{ key: "clickbait", count: 1 }, { key: "copied_or_repackaged", count: 1 }]);
  assert.equal(summary.slopVotes, 1, "Signal percentages use Slop voters, not all votes or selections");
  assert(!JSON.stringify(summary).includes(reasons.otherText), "Public summaries never expose private feedback");
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
    assert.deepEqual((await (await req(path + "/rating", "GET", undefined, null)).json()).signalCounts, [], "Changing to Not slop removes public signal counts");
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
  await verifyOAuth(parentTokens[0], users[0], pool);
  console.log(
    "PASS: UUID schema, auth, capability boundaries, ownership, validation, vote upserts, atomic feedback, source dedupe, concurrent writes, CORS, PKCE, replay/expiry/revocation, OAuth Provider tokens.",
  );
} finally {
  await pool.query("DELETE FROM auth.user WHERE id=ANY($1::uuid[])", [users]);
  await pool.query("DELETE FROM entities WHERE external_id=ANY($1::text[])", [
    ids,
  ]);
  await pool.query(
    "DELETE FROM auth.api_rate_limits WHERE key=ANY($1::text[])",
    [
      users.map((id) =>
        createHash("sha256").update(`write:${id}`).digest("hex"),
      ),
    ],
  );
  await pool.end();
}
