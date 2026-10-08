import { betterAuth } from "better-auth";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import {
  oauthProvider,
  getOAuthProviderApi,
} from "@better-auth/oauth-provider";
import { createAuthEndpoint, APIError } from "better-auth/api";
import { db } from "./db";
import * as schema from "./db/auth-schema";
import { baseUrl, allowedOrigins } from "./config";
export const oauthResource = `${baseUrl}/api/v1`;
export const oauthOptions = {
  loginPage: "/auth/sign-in",
  consentPage: "/auth/error",
  disableJwtPlugin: true,
  scopes: ["openid", "profile", "offline_access", "slop:read", "slop:write"],
  grantTypes: ["authorization_code", "refresh_token"] as (
    "authorization_code" | "refresh_token"
  )[],
  resources: [oauthResource],
  clientRegistrationDefaultResources: [oauthResource],
  allowDynamicClientRegistration: false,
  clientPrivileges: async () => false,
};
export const auth = betterAuth({
  baseURL: baseUrl,
  database: drizzleAdapter(db, { provider: "pg", schemaName: "auth", schema, transaction: true }),
  advanced: { database: { generateId: "uuid" } },
  trustedOrigins: allowedOrigins,
  socialProviders: {
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    },
  },
  session: { expiresIn: 60 * 60 * 24 * 7, cookieCache: { enabled: false } },
  rateLimit: { enabled: true },
  plugins: [
    oauthProvider(oauthOptions),
    {
      id: "slop-resource",
      endpoints: {
        extensionPrincipal: createAuthEndpoint(
          "/extension-principal",
          { method: "GET" },
          async (ctx) => {
            const authorization = ctx.headers?.get("authorization");
            if (!authorization?.startsWith("Bearer "))
              throw new APIError("UNAUTHORIZED");
            const token = await getOAuthProviderApi(
              ctx,
              oauthOptions,
            ).requireActiveAccessToken(authorization.slice(7));
            const audiences = Array.isArray(token.aud)
              ? token.aud
              : [token.aud];
            if (
              !audiences.includes(oauthResource) ||
              token.client_id !== process.env.OAUTH_EXTENSION_CLIENT_ID ||
              !token.sub
            )
              throw new APIError("UNAUTHORIZED");
            const scopes =
              typeof token.scope === "string" ? token.scope.split(" ") : [];
            if (!scopes.includes("slop:read")) throw new APIError("FORBIDDEN");
            const user = await ctx.context.internalAdapter.findUserById(
              token.sub,
            );
            if (!user) throw new APIError("UNAUTHORIZED");
            return ctx.json({ user: { id: user.id, name: user.name }, scopes });
          },
        ),
      },
    },
  ],
});
