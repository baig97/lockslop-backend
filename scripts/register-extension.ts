import { config } from "dotenv";
import { readFileSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
config({ path: ".env.local", quiet: true });
const { pool } = await import("../lib/db");
const { baseUrl, extensionRedirects } = await import("../lib/config");
if (!extensionRedirects.length) throw Error("Configure EXTENSION_IDS first.");
const clientId = process.env.OAUTH_EXTENSION_CLIENT_ID || randomUUID();
const resource = `${baseUrl}/api/v1`;
const scopes = [
  "openid",
  "profile",
  "offline_access",
  "slop:read",
  "slop:write",
];
try {
  // Explicit first-party provisioning. Public registration and client CRUD are disabled.
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    await c.query(
      `INSERT INTO auth.oauth_client(client_id,name,token_endpoint_auth_method,application_type,redirect_uris,grant_types,response_types,scopes,require_pkce,skip_consent,disabled,created_at,updated_at)
      VALUES($1,'Slop Chrome extension','none','web',$2,ARRAY['authorization_code','refresh_token'],ARRAY['code'],$3,true,true,false,now(),now())
      ON CONFLICT(client_id) DO UPDATE SET redirect_uris=EXCLUDED.redirect_uris,scopes=EXCLUDED.scopes,require_pkce=true,skip_consent=true,updated_at=now()`,
      [clientId, extensionRedirects, scopes],
    );
    await c.query(
      `INSERT INTO auth.oauth_resource(identifier,name,allowed_scopes,created_at,updated_at) VALUES($1,'Slop API',$2,now(),now()) ON CONFLICT(identifier) DO NOTHING`,
      [resource, scopes],
    );
    await c.query(
      `INSERT INTO auth.oauth_client_resource(client_id,resource_id,created_at) VALUES($1,$2,now()) ON CONFLICT(client_id,resource_id) DO NOTHING`,
      [clientId, resource],
    );
    await c.query("COMMIT");
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  } finally {
    c.release();
  }
  if (!process.env.OAUTH_EXTENSION_CLIENT_ID) {
    const env = readFileSync(".env.local", "utf8");
    writeFileSync(
      ".env.local",
      env + `\nOAUTH_EXTENSION_CLIENT_ID=${clientId}\n`,
      { mode: 0o600 },
    );
  }
  console.log(
    "Registered first-party public client with exact extension redirects and required PKCE.",
  );
} finally {
  await pool.end();
}
