import { z } from "zod";
export const aiSignalKeys = [
  "repetitive",
  "clickbait",
  "low_information_density",
  "ai_generated_filler",
  "copied_or_repackaged",
] as const;
export const aiResultSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("ready"),
    signals: z.array(
      z.object({ key: z.enum(aiSignalKeys), score: z.number().min(0).max(1) }),
    ),
    generatedAt: z.string().datetime(),
  }),
  z.object({ status: z.literal("unavailable"), retryable: z.boolean() }),
  z.object({
    status: z.literal("unsupported_language"),
    detectedLanguage: z.string().regex(/^[a-z]{3}$/),
  }),
]);
export const overviewSchema = z.object({
  entity: z.object({
    id: z.string().uuid(),
    type: z.literal("youtube_video"),
    externalId: z.string(),
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
});
export type VideoOverviewDto = z.infer<typeof overviewSchema>;
export type AiResult = VideoOverviewDto["ai"];
