import assert from "node:assert/strict";
import { ensureExtensionRegistration } from "../lib/oauth-registration";

type Row = Record<string, unknown>;
type Where = { field: string; value: unknown }[];
const models = ["oauthClient", "oauthResource", "oauthClientResource"];
const local = "http://localhost:3000/api/v1";
const production = "https://lockslop-backend.vercel.app/api/v1";
let rows: Record<string, Row[]> = Object.fromEntries(models.map(model => [model, []]));
let failLink = false;
const matches = (row: Row, where: Where) => where.every(item => row[item.field] === item.value);
const adapter = {
  async transaction(callback: (tx: unknown) => Promise<unknown>) {
    const before = structuredClone(rows);
    try {
      return await callback({
        async findOne({ model, where }: { model: string; where: Where }) {
          return rows[model].find(row => matches(row, where)) ?? null;
        },
        async update({ model, where, update }: { model: string; where: Where; update: Row }) {
          const row = rows[model].find(row => matches(row, where));
          if (row) Object.assign(row, update);
          return row;
        },
        async create({ model, data }: { model: string; data: Row }) {
          if (model === "oauthClientResource" && failLink) throw Error("Fixture link failure");
          const row = { ...data, id: String(rows[model].length + 1) };
          rows[model].push(row);
          return row;
        },
      });
    } catch (error) { rows = before; throw error; }
  },
} as unknown as Parameters<typeof ensureExtensionRegistration>[0];
const input = {
  clientId: "existing-client",
  resource: local,
  redirectUris: ["https://dannlppmdplnpdmaekanbdkokfjnieam.chromiumapp.org/"],
  scopes: ["openid", "profile", "offline_access", "slop:read", "slop:write"],
};
await assert.rejects(ensureExtensionRegistration(adapter, { ...input, requireExisting: true }), /absent from this database/);
assert.equal(rows.oauthClient.length, 0, "Existing-only repair cannot create a client in the wrong database");
await ensureExtensionRegistration(adapter, input);
assert.equal(rows.oauthClient.length, 1);
assert.equal(rows.oauthClient[0].tokenEndpointAuthMethod, "none");
assert.equal(rows.oauthClient[0].requirePKCE, true);
await ensureExtensionRegistration(adapter, { ...input, resource: production });
assert.equal(rows.oauthClient.length, 1, "Production setup retains the existing client ID");
assert.equal(rows.oauthResource.length, 2);
assert.deepEqual(rows.oauthClientResource.map(row => row.resourceId), [local, production], "Both environment resource links are retained");
const originalPolicy = { ...rows.oauthResource[1], accessTokenTtl: 300, policyVersion: 4 };
rows.oauthResource[1] = originalPolicy;
await ensureExtensionRegistration(adapter, { ...input, resource: production });
assert.equal(rows.oauthClientResource.length, 2, "Repeated setup does not duplicate links");
assert.deepEqual(rows.oauthResource[1], originalPolicy, "Existing resource policies are preserved");
rows.oauthClientResource = rows.oauthClientResource.filter(row => row.resourceId !== production);
await ensureExtensionRegistration(adapter, { ...input, resource: production });
assert.equal(rows.oauthClientResource.length, 2, "An existing client missing its production link is repaired");
const snapshot = structuredClone(rows);
failLink = true;
await assert.rejects(ensureExtensionRegistration(adapter, { ...input, clientId: "new-client" }), /Fixture link failure/);
assert.deepEqual(rows, snapshot, "A failed link operation rolls back client creation");
failLink = false;
rows.oauthClient[0].disabled = true;
await assert.rejects(ensureExtensionRegistration(adapter, input), /disabled/);
assert.equal(rows.oauthClient[0].disabled, true, "Setup cannot reactivate a disabled client");
await assert.rejects(ensureExtensionRegistration(adapter, { ...input, redirectUris: ["https://example.com/"] }), /exact Chrome/);
console.log("PASS: first-party creation, existing-client production link repair, repeat setup, retained local links/resource policy, rollback, disabled-client and redirect checks. In-memory adapter; no database access.");
