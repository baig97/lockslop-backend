import { sql } from "drizzle-orm";
import {
  pgTable,
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
    externalId: text("external_id").notNull(),
    canonicalUrl: text("canonical_url").notNull(),
    createdAt: created(),
  },
  (t) => [unique().on(t.entityType, t.externalId)],
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

export const contentPayloads = pgTable(
  "content_payloads",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    entityId: uuid("entity_id")
      .notNull()
      .unique()
      .references(() => entities.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    payload: jsonb("payload").notNull(),
    revision: uuid("revision").notNull().defaultRandom(),
    status: text("status").notNull().default("ready"),
    createdAt: created(),
    updatedAt: updated(),
  },
  (t) => [check("payload_status", sql`${t.status} in ('ready','stale')`)],
);
export const aiContentSignals = pgTable(
  "ai_content_signals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    entityId: uuid("entity_id")
      .notNull()
      .references(() => entities.id, { onDelete: "cascade" }),
    signalKey: text("signal_key").notNull(),
    score: doublePrecision("score").notNull(),
    payloadRevision: uuid("payload_revision").notNull(),
    generatorVersion: text("generator_version").notNull(),
    createdAt: created(),
    updatedAt: updated(),
  },
  (t) => [
    unique().on(t.entityId, t.signalKey),
    check("ai_score_range", sql`${t.score} >= 0 AND ${t.score} <= 1`),
  ],
);
