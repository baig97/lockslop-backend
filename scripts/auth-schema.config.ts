// Schema-only configuration: no runtime resource seeding before migrations exist.
import { betterAuth } from "better-auth";
import { oauthProvider } from "@better-auth/oauth-provider";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { db } from "../lib/db";
export const auth = betterAuth({
  database: drizzleAdapter(db, { provider: "pg", schemaName: "auth" }),
  advanced: { database: { generateId: "uuid" } },
  plugins: [
    oauthProvider({
      loginPage: "/auth/sign-in",
      consentPage: "/auth/error",
      disableJwtPlugin: true,
    }),
  ],
});
