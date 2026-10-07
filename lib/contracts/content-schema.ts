import { z } from "zod";
export const entityTypes = ["youtube_video", "linkedin_post"] as const;
export const identitySchema = z
  .object({
    entityType: z.enum(entityTypes),
    url: z.string().url().max(2048).nullable().optional(),
    externalId: z.string().trim().min(1).max(256).nullable().optional(),
  })
  .strict()
  .refine(
    (v) => !!v.url !== !!v.externalId,
    "Exactly one identifier is required",
  );
export type ContentIdentity = z.infer<typeof identitySchema>;
export const contentHashSchema = z.string().regex(/^sha256:[0-9a-f]{64}$/);
export const lookupItemSchema = z
  .object({
    entityType: z.enum(entityTypes),
    url: z.string().url().max(2048).nullable().optional(),
    externalId: z.string().trim().min(1).max(256).nullable().optional(),
    contentHash: contentHashSchema,
  })
  .strict()
  .refine(
    (v) => !!v.url !== !!v.externalId,
    "Exactly one identifier is required",
  );
export type LookupItem = z.infer<typeof lookupItemSchema>;
export const envelopeSchema = z
  .object({ entities: z.array(z.unknown()).min(1).max(10) })
  .strict();
const nullableText = z.string().nullable().default(null);
const publication = z.iso.datetime({ offset: true }).nullable().default(null);
const count = z.number().int().nonnegative().nullable().default(null);
const comments = z
  .object({
    status: z.enum(["available", "unavailable", "disabled"]),
    items: z.array(z.object({ text: z.string() })).max(10),
  })
  .strict()
  .refine(
    (v) => v.status === "available" || !v.items.length,
    "Unavailable comments cannot contain items",
  )
  .default({ status: "unavailable", items: [] });
export const youtubeContentSchema = z
  .object({
    schemaVersion: z.literal(2),
    title: z.string().min(1),
    description: z.string(),
    publishedAt: publication,
    durationSeconds: z.number().finite().nonnegative().nullable().default(null),
    languageHint: nullableText,
    liveBroadcastContent: z
      .enum(["none", "live", "upcoming"])
      .nullable()
      .default(null),
    tags: z.array(z.string()).max(100).default([]),
    comments,
    counts: z
      .object({ comments: count, views: count, likes: count })
      .strict()
      .default({ comments: null, views: null, likes: null }),
  })
  .strict();
export const linkedinContentSchema = z
  .object({
    schemaVersion: z.literal(2),
    text: z.string().min(1),
    publishedAt: publication,
    languageHint: nullableText,
    comments,
    counts: z
      .object({ comments: count, reactions: count, reposts: count })
      .strict()
      .default({ comments: null, reactions: null, reposts: null }),
  })
  .strict();
export type YouTubeContent = z.infer<typeof youtubeContentSchema>;
export type LinkedInContent = z.infer<typeof linkedinContentSchema>;
export type DerivedContent = YouTubeContent | LinkedInContent;
export const MAX_CONTENT_BYTES = 32 * 1024;
export function sanitizeContent(
  type: "youtube_video",
  raw: unknown,
): YouTubeContent;
export function sanitizeContent(
  type: "linkedin_post",
  raw: unknown,
): LinkedInContent;
export function sanitizeContent(
  type: ContentIdentity["entityType"],
  raw: unknown,
): DerivedContent;
export function sanitizeContent(
  type: ContentIdentity["entityType"],
  raw: unknown,
): DerivedContent {
  const value = (
    type === "youtube_video" ? youtubeContentSchema : linkedinContentSchema
  ).parse(raw);
  if (
    new TextEncoder().encode(JSON.stringify(value, null, 2)).length >
    MAX_CONTENT_BYTES
  )
    throw Error("Content exceeds 32 KiB");
  return value;
}
export function sortedJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(sortedJson).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.keys(value)
      .sort()
      .map(
        (k) =>
          `${JSON.stringify(k)}:${sortedJson((value as Record<string, unknown>)[k])}`,
      )
      .join(",")}}`;
  return JSON.stringify(value);
}
export function canonicalContent(
  type: ContentIdentity["entityType"],
  raw: DerivedContent,
) {
  const v = sanitizeContent(type, raw);
  return type === "youtube_video" && "description" in v
    ? {
        schemaVersion: v.schemaVersion,
        entityType: type,
        title: v.title,
        description: v.description,
        publishedAt: v.publishedAt,
        durationSeconds: v.durationSeconds,
      }
    : {
        schemaVersion: v.schemaVersion,
        entityType: type,
        text: (v as LinkedInContent).text,
        publishedAt: v.publishedAt,
      };
}
