import type { BetterAuthOptions } from "better-auth";
import type { DBAdapter } from "@better-auth/core/db/adapter";

interface Registration {
  clientId: string;
  resource: string;
  redirectUris: string[];
  scopes: string[];
  requireExisting?: boolean;
}

/** Trusted operator setup through Better Auth's adapter, never a public endpoint. */
export async function ensureExtensionRegistration<Options extends BetterAuthOptions>(
  adapter: Pick<DBAdapter<Options>, "transaction">,
  registration: Registration,
) {
  const { clientId, resource, redirectUris, scopes } = registration;
  if (!clientId || !redirectUris.length || !scopes.length)
    throw new Error("Client ID, extension redirects, and scopes are required.");
  const target = new URL(resource);
  if (target.protocol !== "https:" && !(target.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(target.hostname)))
    throw new Error("Non-local OAuth resources must use HTTPS.");
  for (const redirect of redirectUris) {
    const url = new URL(redirect);
    if (url.protocol !== "https:" || !/^[a-p]{32}\.chromiumapp\.org$/.test(url.hostname) || url.pathname !== "/" || url.search || url.hash || url.port || url.username || url.password)
      throw new Error("Use exact Chrome extension OAuth redirects.");
  }

  await adapter.transaction(async (tx) => {
    const clientWhere = [{ field: "clientId", value: clientId }];
    const client = await tx.findOne<{ id: string; disabled?: boolean; tokenEndpointAuthMethod?: string }>({ model: "oauthClient", where: clientWhere });
    if (!client && registration.requireExisting)
      throw new Error("The configured client is absent from this database. Check DATABASE_URL before repairing production.");
    if (client?.disabled) throw new Error("The extension OAuth client is disabled.");
    if (client && client.tokenEndpointAuthMethod !== "none")
      throw new Error("The existing extension client must be a public OAuth client.");
    const now = new Date();
    const clientData = {
      name: "Lockslop Chrome extension",
      redirectUris,
      scopes,
      grantTypes: ["authorization_code", "refresh_token"],
      responseTypes: ["code"],
      requirePKCE: true,
      skipConsent: true,
      updatedAt: now,
    };
    if (client) await tx.update({ model: "oauthClient", where: clientWhere, update: clientData });
    else await tx.create({ model: "oauthClient", data: { ...clientData, clientId, tokenEndpointAuthMethod: "none", applicationType: "web", disabled: false, createdAt: now } });

    const resourceWhere = [{ field: "identifier", value: resource }];
    const existingResource = await tx.findOne<{ id: string; disabled?: boolean }>({ model: "oauthResource", where: resourceWhere });
    if (existingResource?.disabled) throw new Error("The API OAuth resource is disabled.");
    if (!existingResource) await tx.create({ model: "oauthResource", data: {
      identifier: resource, name: "Lockslop API", allowedScopes: scopes,
      disabled: false, policyVersion: 1, createdAt: now, updatedAt: now,
    } });

    const linkWhere = [{ field: "clientId", value: clientId }, { field: "resourceId", value: resource }];
    if (!await tx.findOne({ model: "oauthClientResource", where: linkWhere }))
      await tx.create({ model: "oauthClientResource", data: { clientId, resourceId: resource, createdAt: now } });
  });
  return { clientId, resource };
}
