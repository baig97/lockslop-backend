import assert from "node:assert/strict";
import { startGoogleSignIn } from "../lib/google-sign-in";
const base = "https://lockslop-backend.vercel.app";
const request = new Request(`${base}/auth/sign-in?client_id=fixture&state=fixture-state&sig=fixture-signature`, { headers: { cookie: "fixture=cookie" } });
let calls = 0;
const signIn: Parameters<typeof startGoogleSignIn>[1] = async options => {
  calls++;
  assert.equal(options.body.provider, "google");
  assert.equal(new URLSearchParams(options.body.oauth_query).get("sig"), "fixture-signature");
  assert.equal(options.body.disableRedirect, true);
  assert.equal(options.headers.get("cookie"), "fixture=cookie");
  assert.equal(options.asResponse, true);
  const headers = new Headers({ "Content-Type": "application/json" });
  headers.append("Set-Cookie", "oauth_state=fixture; Path=/; HttpOnly; Secure");
  headers.append("Set-Cookie", "oauth_nonce=fixture; Path=/; HttpOnly; Secure");
  return new Response(JSON.stringify({ url: "https://accounts.google.com/o/oauth2/v2/auth?state=fixture" }), { headers });
};
const missing = await startGoogleSignIn(new Request(`${base}/auth/sign-in`), signIn, base);
assert.equal(missing.status, 400);
assert.equal(calls, 0, "Unsigned entry cannot initiate social sign-in");
const response = await startGoogleSignIn(request, signIn, base);
assert.equal(response.status, 302);
assert.equal(new URL(response.headers.get("Location")!).hostname, "accounts.google.com");
assert.equal(await response.text(), "", "No custom interstitial is rendered");
assert.equal(response.headers.getSetCookie().length, 2, "Both Better Auth state cookies reach the browser");
assert.equal(response.headers.get("Cache-Control"), "no-store");
const rejected = await startGoogleSignIn(request, async () => new Response(null, { status: 400 }), base);
assert.equal(rejected.status, 400);
assert.equal(rejected.headers.get("Location"), null);
const oldWarn = console.warn; console.warn = () => {};
try {
  const unexpected = await startGoogleSignIn(request, async () => Response.json({ url: "https://example.com/" }), base);
  assert.equal(unexpected.status, 502);
  assert.equal(unexpected.headers.get("Location"), null, "Unexpected provider destinations cannot become redirects");
} finally { console.warn = oldWarn; }
console.log("PASS: direct Google redirect, preserved OAuth query and cookies, unsigned/rejected requests, no interstitial, and destination validation. Stub provider; no database or Google account access.");
