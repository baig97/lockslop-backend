import { z } from "zod";
import { signalKeys, youtubeSignalKeys, completeSignalSet } from "./signals";
// Compatibility export for existing YouTube callers. Platform code uses signalsFor().
export const aiSignalKeys = youtubeSignalKeys;
export const aiResultSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("ready"),
    signals: z
      .array(
        z.object({
          key: z.enum(signalKeys),
          score: z.number().min(0).max(1),
        }),
      )
      .refine(
        (signals) =>
          completeSignalSet("youtube_video", signals) ||
          completeSignalSet("linkedin_post", signals),
        "Incomplete platform signal set",
      ),
    generatedAt: z.string().datetime(),
  }),
  z.object({ status: z.literal("unavailable"), retryable: z.boolean() }),
  z.object({ status: z.literal("needs_input") }),
  z.object({
    status: z.literal("unsupported_language"),
    detectedLanguage: z.string().regex(/^[a-z]{3}$/),
  }),
]);
export const overviewSchema = z
  .object({
    entity: z.object({
      id: z.string().uuid(),
      type: z.enum(["youtube_video", "linkedin_post"]),
      externalId: z.string().nullable(),
      canonicalUrl: z.string().url().nullable(),
    }),
    community: z.object({
      slopVotes: z.number().int().nonnegative(),
      notSlopVotes: z.number().int().nonnegative(),
      signals: z.array(
        z.object({ key: z.string(), count: z.number().int().nonnegative() }),
      ),
    }),
    viewer: z.discriminatedUnion("status", [
      z.object({ status: z.literal("anonymous") }),
      z.object({
        status: z.literal("authenticated"),
        vote: z.enum(["slop", "not_slop"]).nullable(),
      }),
    ]),
    ai: aiResultSchema,
  })
  .superRefine((value, ctx) => {
    if (
      value.ai.status === "ready" &&
      !completeSignalSet(value.entity.type, value.ai.signals)
    )
      ctx.addIssue({
        code: "custom",
        path: ["ai", "signals"],
        message: "Signals do not match entity type",
      });
  });
export type ContentOverviewDto = z.infer<typeof overviewSchema>;
export type AiResult = ContentOverviewDto["ai"];

export type VideoOverviewDto = ContentOverviewDto;

export const batchOverviewSchema = z.object({
  results: z
    .array(
      z.discriminatedUnion("status", [
        z.object({
          index: z.number().int().min(0).max(9),
          request: z.object({
            entityType: z.enum(["youtube_video", "linkedin_post"]),
            url: z.string().nullable().optional(),
            externalId: z.string().nullable().optional(),
            contentHash: z.string(),
          }),
          status: z.literal("success"),
          overview: overviewSchema,
        }),
        z.object({
          index: z.number().int().min(0).max(9),
          request: z.unknown().nullable(),
          status: z.literal("error"),
          error: z.object({
            code: z.enum(["invalid_input", "rate_limited", "unavailable"]),
            message: z.string(),
            retryable: z.boolean(),
          }),
        }),
      ]),
    )
    .max(10),
});
export type BatchOverviewDto = z.infer<typeof batchOverviewSchema>;
