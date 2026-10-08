import { config } from "dotenv";
import { appendFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { ensureExtensionRegistration } from "../lib/oauth-registration";
config({ path: ".env.local", quiet: true });
const { auth, oauthOptions, oauthResource } = await import("../lib/auth");
const { pool } = await import("../lib/db");
const { extensionRedirects } = await import("../lib/config");
const configuredClientId = process.env.OAUTH_EXTENSION_CLIENT_ID;
const clientId = configuredClientId || randomUUID();
try {
  if (!extensionRedirects.length) throw Error("Configure EXTENSION_IDS first.");
  const { adapter } = await auth.$context;
  await ensureExtensionRegistration(adapter, {
    clientId, resource: oauthResource, redirectUris: extensionRedirects,
    scopes: oauthOptions.scopes,
    requireExisting: process.argv.includes("--existing-only"),
  });
  if (!configuredClientId)
    appendFileSync(".env.local", `\nOAUTH_EXTENSION_CLIENT_ID=${clientId}\n`, { mode: 0o600 });
  console.log(`Registered extension client ${clientId} for ${oauthResource} through Better Auth's adapter.`);
} finally {
  await pool.end();
}
