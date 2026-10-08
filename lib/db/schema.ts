import { sql } from "drizzle-orm";
import {
  pgTable,
  boolean,
  uuid,
  text,
  timestamp,
  primaryKey,
  unique,
  index,
  check,
  foreignKey,
  integer,
  jsonb,
  doublePrecision,
} from "drizzle-orm/pg-core";
import { authSchema, user } from "./auth-schema";
const created = () =>
  timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updated = () =>
  timestamp("updated_at", { withTimezone: true }).notNull().defaultNow();
export const entities = pgTable(
  "entities",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    entityType: text("entity_type").notNull(),
    externalId: text("external_id"),
    canonicalUrl: text("canonical_url"),
    createdAt: created(),
  },
  (t) => [
    unique().on(t.entityType, t.externalId),
    unique().on(t.entityType, t.canonicalUrl),
    check(
      "entity_identifier_xor",
      sql`(${t.externalId} IS NULL) <> (${t.canonicalUrl} IS NULL)`,
    ),
    check(
      "entity_identifier_nonempty",
      sql`(${t.externalId} IS NULL OR length(trim(${t.externalId})) > 0) AND (${t.canonicalUrl} IS NULL OR length(trim(${t.canonicalUrl})) > 0)`,
    ),
  ],
);
export const contentVotes = pgTable(
  "content_votes",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    entityId: uuid("entity_id")
      .notNull()
      .references(() => entities.id, { onDelete: "cascade" }),
    vote: text("vote").notNull(),
    createdAt: created(),
    updatedAt: updated(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.entityId] }),
    index("votes_entity_idx").on(t.entityId),
    check("vote_value", sql`${t.vote} in ('slop','not_slop')`),
  ],
);
export const slopSignals = pgTable("slop_signals", {
  id: uuid("id").primaryKey().defaultRandom(),
  key: text("key").notNull().unique(),
});
export const contentVoteSignals = pgTable(
  "content_vote_signals",
  {
    userId: uuid("user_id").notNull(),
    entityId: uuid("entity_id").notNull(),
    signalId: uuid("signal_id")
      .notNull()
      .references(() => slopSignals.id),
    createdAt: created(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.entityId, t.signalId] }),
    foreignKey({
      columns: [t.userId, t.entityId],
      foreignColumns: [contentVotes.userId, contentVotes.entityId],
    }).onDelete("cascade"),
    index("signals_entity_idx").on(t.entityId),
  ],
);
export const contentVoteFeedback = pgTable(
  "content_vote_feedback",
  {
    userId: uuid("user_id").notNull(),
    entityId: uuid("entity_id").notNull(),
    otherText: text("other_text").notNull(),
    createdAt: created(),
    updatedAt: updated(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.entityId] }),
    foreignKey({
      columns: [t.userId, t.entityId],
      foreignColumns: [contentVotes.userId, contentVotes.entityId],
    }).onDelete("cascade"),
    check(
      "feedback_length",
      sql`char_length(${t.otherText}) between 1 and 500`,
    ),
  ],
);
export const contentReports = pgTable(
  "content_reports",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    reporterUserId: uuid("reporter_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    entityId: uuid("entity_id")
      .notNull()
      .references(() => entities.id, { onDelete: "cascade" }),
    sourceEntityId: uuid("source_entity_id")
      .notNull()
      .references(() => entities.id),
    reportType: text("report_type").notNull(),
    createdAt: created(),
  },
  (t) => [
    unique().on(t.reporterUserId, t.entityId, t.sourceEntityId, t.reportType),
    check("report_type_value", sql`${t.reportType} = 'copied_from'`),
    check("report_not_self", sql`${t.entityId} <> ${t.sourceEntityId}`),
    index("reports_entity_idx").on(t.entityId),
    index("reports_source_idx").on(t.sourceEntityId),
  ],
);
// Auth infrastructure, separate from the content domain.
export const apiRateLimits = authSchema.table("api_rate_limits", {
  id: uuid("id").primaryKey().defaultRandom(),
  key: text("key").notNull().unique(),
  count: integer("count").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});

export const contentAnalyses = pgTable(
  "content_analyses",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    entityId: uuid("entity_id")
      .notNull()
      .references(() => entities.id, { onDelete: "cascade" }),
    contentHash: text("content_hash").notNull(),
    userId: uuid("user_id").references(() => user.id, { onDelete: "set null" }),
    input: jsonb("input").notNull(),
    status: text("status").notNull(),
    detectedLanguage: text("detected_language"),
    generatorVersion: text("generator_version").notNull(),
    generatedAt: timestamp("generated_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: created(),
    updatedAt: updated(),
  },
  (t) => [
    unique().on(t.entityId, t.contentHash),
    index("analyses_expiry_idx").on(t.expiresAt),
    check("analysis_hash", sql`${t.contentHash} ~ '^sha256:[0-9a-f]{64}$'`),
    check(
      "analysis_status",
      sql`${t.status} in ('pending','ready','failed','unsupported_language')`,
    ),
    check(
      "analysis_ready_date",
      sql`${t.status} <> 'ready' OR ${t.generatedAt} IS NOT NULL`,
    ),
    check(
      "analysis_language",
      sql`${t.status} <> 'unsupported_language' OR (${t.detectedLanguage} IS NOT NULL AND ${t.detectedLanguage} ~ '^[a-z]{3}$')`,
    ),
  ],
);
export const aiContentSignals = pgTable(
  "ai_content_signals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    analysisId: uuid("analysis_id")
      .notNull()
      .references(() => contentAnalyses.id, { onDelete: "cascade" }),
    signalKey: text("signal_key")
      .notNull()
      .references(() => slopSignals.key),
    score: doublePrecision("score").notNull(),
    createdAt: created(),
    updatedAt: updated(),
  },
  (t) => [
    unique().on(t.analysisId, t.signalKey),
    check("ai_score_range", sql`${t.score} >= 0 AND ${t.score} <= 1`),
  ],
);

// One current privacy choice per account; no consent-history subsystem.
export const privacyConsent = authSchema.table("privacy_consent", {
  userId: uuid("user_id").primaryKey().references(() => user.id, { onDelete: "cascade" }),
  policyVersion: text("policy_version").notNull(),
  accepted: boolean("accepted").notNull(),
  updatedAt: updated(),
});
