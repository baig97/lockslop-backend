import assert from "node:assert/strict";
import { randomBytes, createHash, createHmac } from "node:crypto";
const base = process.env.BETTER_AUTH_URL || "http://localhost:3000";
export const clientId = process.env.OAUTH_EXTENSION_CLIENT_ID!;
export const resource = `${base}/api/v1`;
export const redirectUri = `https://${process.env.EXTENSION_IDS!.split(",")[0]}.chromiumapp.org/`;
export function sessionCookie(token: string) {
  return `better-auth.session_token=${encodeURIComponent(token + "." + createHmac("sha256", process.env.BETTER_AUTH_SECRET!).update(token).digest("base64"))}`;
}
export async function authorize(
  parentToken: string,
  overrides: Record<string, string> = {},
) {
  const verifier = randomBytes(32).toString("base64url"),
    state = randomBytes(32).toString("base64url");
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "openid profile offline_access slop:read slop:write",
    resource,
    state,
    code_challenge: createHash("sha256").update(verifier).digest("base64url"),
    code_challenge_method: "S256",
    ...overrides,
  });
  const response = await fetch(`${base}/api/auth/oauth2/authorize?${params}`, {
    headers: {
      Cookie: sessionCookie(parentToken),
      Accept: "text/html",
      "Sec-Fetch-Mode": "navigate",
    },
    redirect: "manual",
  });
  const location =
    response.headers.get("location") ||
    (response.status === 200 ? (await response.clone().json()).url : null);
  return {
    response,
    callback: location ? new URL(location, base) : null,
    verifier,
    state,
  };
}
export async function oauthPost(
  endpoint: string,
  body: Record<string, string>,
) {
  return fetch(`${base}/api/auth/oauth2/${endpoint}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: clientId, ...body }),
  });
}
export async function issue(
  parentToken: string,
  overrides: Record<string, string> = {},
) {
  const a = await authorize(parentToken, overrides);
  assert([200, 302].includes(a.response.status));
  assert.equal(
    a.callback?.origin,
    new URL(redirectUri).origin,
    `Authorization did not complete: ${a.callback?.pathname}`,
  );
  assert.equal(a.callback.searchParams.get("state"), a.state);
  assert.equal(a.callback.searchParams.get("iss"), `${base}/api/auth`);
  assert(a.callback.searchParams.has("code"), "Expected an authorization code");
  const fields = {
    grant_type: "authorization_code",
    code: a.callback.searchParams.get("code")!,
    code_verifier: a.verifier,
    redirect_uri: redirectUri,
    resource,
  };
  const response = await oauthPost("token", fields);
  if (response.status !== 200)
    throw Error(
      `Token exchange failed (${response.status}): ${(await response.json()).error}`,
    );
  return { tokens: await response.json(), fields };
}
export async function verifyOAuth(
  parentToken: string,
  userId: string,
  pool: import("pg").Pool,
) {
  const first = await issue(parentToken);
  const replay = await oauthPost("token", first.fields);
  assert.equal(replay.status, 400, "Authorization codes are one use");
  const bad = await authorize(parentToken);
  assert.equal(
    (
      await oauthPost("token", {
        grant_type: "authorization_code",
        code: bad.callback!.searchParams.get("code")!,
        code_verifier: randomBytes(32).toString("base64url"),
        redirect_uri: redirectUri,
        resource,
      })
    ).status,
    401,
    "Wrong PKCE rejected",
  );
  const wrongRedirect = await authorize(parentToken, {
    redirect_uri: "https://evil.example/",
  });
  assert(
    !wrongRedirect.callback ||
      wrongRedirect.callback.origin !== new URL("https://evil.example").origin,
    "Unregistered redirects rejected",
  );
  const noPkce = await authorize(parentToken, { code_challenge: "" });
  assert(!noPkce.callback?.searchParams.has("code"));
  const readOnly = await issue(parentToken, {
    scope: "openid profile offline_access slop:read",
  });
  const forbidden = await fetch(
    `${base}/api/v1/youtube/videos/abcdefghijk/my-vote`,
    {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${readOnly.tokens.access_token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ vote: "slop" }),
    },
  );
  assert.equal(forbidden.status, 403);
  const fresh = await issue(parentToken);
  const refreshed = await oauthPost("token", {
    grant_type: "refresh_token",
    refresh_token: fresh.tokens.refresh_token,
    resource,
  });
  assert.equal(refreshed.status, 200);
  const rotated = await refreshed.json();
  assert(rotated.refresh_token);
  assert.equal(
    (
      await fetch(`${base}/api/extension/session`, {
        headers: { Authorization: `Bearer ${rotated.access_token}` },
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await oauthPost("revoke", {
        token: rotated.refresh_token,
        token_type_hint: "refresh_token",
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await oauthPost("token", {
        grant_type: "refresh_token",
        refresh_token: rotated.refresh_token,
        resource,
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await fetch(`${base}/api/extension/session`, {
        headers: { Authorization: `Bearer ${rotated.access_token}` },
      })
    ).status,
    401,
  );
  const expired = await issue(parentToken);
  await pool.query(
    `UPDATE auth.oauth_access_token SET expires_at=now()-interval '1 second' WHERE user_id=$1`,
    [userId],
  );
  assert.equal(
    (
      await fetch(`${base}/api/extension/session`, {
        headers: { Authorization: `Bearer ${expired.tokens.access_token}` },
      })
    ).status,
    401,
  );
  assert.equal(
    (
      await fetch(`${base}/api/extension/session`, {
        headers: { Authorization: `Bearer ${parentToken}` },
      })
    ).status,
    401,
    "Raw session bearer tokens are no longer accepted",
  );
  assert.equal(
    (await fetch(`${base}/api/extension/start`)).status,
    404,
    "Custom handoff removed",
  );
  assert.equal(
    (
      await fetch(`${base}/api/auth/oauth2/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      })
    ).status,
    403,
    "Dynamic registration disabled",
  );
  console.log(
    "PASS: OAuth Provider PKCE, redirect validation, code replay, scope enforcement, refresh, revocation, expiry, legacy-token rejection.",
  );
}
