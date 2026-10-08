import { config } from "dotenv";
config({ path: ".env.local", quiet: true });
import assert from "node:assert/strict";
import { randomUUID, randomBytes } from "node:crypto";
const { pool } = await import("../lib/db");
const { issue, oauthPost, resource } = await import("./oauth-test-helper");
const base = process.env.BETTER_AUTH_URL || "http://localhost:3000";
assert(["localhost", "127.0.0.1"].includes(new URL(base).hostname));
const user = randomUUID(),
  parent = randomBytes(32).toString("hex");
let access = "";
async function request(
  path: string,
  method = "GET",
  data?: unknown,
  authenticated = true,
) {
  return fetch(base + path, {
    method,
    headers: {
      ...(authenticated ? { Authorization: `Bearer ${access}` } : {}),
      ...(data !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    ...(data !== undefined ? { body: JSON.stringify(data) } : {}),
  });
}
try {
  await pool.query(
    "INSERT INTO auth.user(id,name,email) VALUES($1,'Consent fixture',$2)",
    [user, `${user}@example.invalid`],
  );
  await pool.query(
    "INSERT INTO auth.session(token,user_id,expires_at,updated_at) VALUES($1,$2,now()+interval '1 hour',now())",
    [parent, user],
  );
  const { tokens } = await issue(parent);
  access = tokens.access_token;
  const policy = await (
    await request("/api/extension/privacy-consent", "GET", undefined, false)
  ).json();
  assert.equal(policy.currentVersion, process.env.PRIVACY_POLICY_VERSION);
  assert.equal(
    (
      await request(
        "/api/extension/privacy-consent",
        "POST",
        { version: policy.currentVersion, accepted: true },
        false,
      )
    ).status,
    401,
  );
  assert.equal(
    (await (await request("/api/extension/session")).json()).privacy
      .requiresConsent,
    true,
  );
  for (const path of ["content/overviews:batch", "content/ai-signals:derive"])
    assert.equal(
      (await request("/api/v1/" + path, "POST", {})).status,
      403,
      "Gate precedes input processing",
    );
  assert.equal(
    (
      await request("/api/extension/privacy-consent", "POST", {
        version: "old-version",
        accepted: true,
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await request("/api/extension/privacy-consent", "POST", {
        version: policy.currentVersion,
        accepted: "yes",
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await request("/api/extension/privacy-consent", "POST", {
        version: policy.currentVersion,
        accepted: true,
        userId: randomUUID(),
      })
    ).status,
    400,
  );
  const accept = () =>
    request("/api/extension/privacy-consent", "POST", {
      version: policy.currentVersion,
      accepted: true,
    });
  assert.equal((await accept()).status, 200);
  assert.equal((await accept()).status, 200);
  assert.equal(
    (
      await pool.query(
        "SELECT count(*)::int AS count FROM auth.privacy_consent WHERE user_id=$1",
        [user],
      )
    ).rows[0].count,
    1,
  );
  assert.equal(
    (await (await request("/api/extension/session")).json()).privacy
      .requiresConsent,
    false,
  );
  assert.equal(
    (await request("/api/v1/content/ai-signals:derive", "POST", {})).status,
    400,
    "Accepted user reaches payload validation",
  );
  await pool.query(
    "UPDATE auth.privacy_consent SET policy_version='previous' WHERE user_id=$1",
    [user],
  );
  assert.equal(
    (await (await request("/api/extension/privacy-consent")).json())
      .requiresConsent,
    true,
  );
  assert.equal(
    (await request("/api/v1/content/ai-signals:derive", "POST", {})).status,
    403,
  );
  assert.equal((await accept()).status, 200);
  assert.equal(
    (
      await request("/api/extension/privacy-consent", "POST", {
        version: policy.currentVersion,
        accepted: false,
      })
    ).status,
    200,
  );
  const record = (
    await pool.query(
      "SELECT accepted,policy_version FROM auth.privacy_consent WHERE user_id=$1",
      [user],
    )
  ).rows[0];
  assert.equal(record.accepted, false);
  assert.equal(record.policy_version, policy.currentVersion);
  assert.equal((await request("/api/extension/session")).status, 401);
  assert.equal(
    (
      await oauthPost("token", {
        grant_type: "refresh_token",
        refresh_token: tokens.refresh_token,
        resource,
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await pool.query(
        "SELECT count(*)::int AS count FROM auth.session WHERE user_id=$1",
        [user],
      )
    ).rows[0].count,
    0,
  );
  console.log(
    "PASS: authenticated account choice, one-row upsert, malformed and stale choices, content gate, new-version reconsent, decline persistence, session and OAuth revocation.",
  );
} finally {
  await pool.query("DELETE FROM auth.user WHERE id=$1", [user]);
  await pool.end();
}
