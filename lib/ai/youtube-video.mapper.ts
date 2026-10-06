import { z } from "zod";

export const MAX_FILTERED_BYTES = 32 * 1024;
const optionalText = z
  .string()
  .nullable()
  .optional()
  .transform((value) => value ?? null);
const commentThreadSchema = z.object({
  snippet: z.object({
    videoId: z.string(),
    topLevelComment: z.object({
      snippet: z.object({
        textDisplay: z.string(),
        publishedAt: z.iso.datetime({ offset: true }),
        updatedAt: z.iso.datetime({ offset: true }),
      }),
    }),
  }),
});
const commentThreadsSchema = z
  .object({
    status: z.enum(["ready", "disabled", "unavailable"]),
    order: z.literal("relevance"),
    items: z.array(commentThreadSchema).max(10),
  })
  .superRefine((value, ctx) => {
    if (value.status !== "ready" && value.items.length)
      ctx.addIssue({
        code: "custom",
        message: "Unavailable comments cannot contain items",
      });
  });
export function validateYouTubeComments(raw: unknown, videoId: string) {
  const sample = commentThreadsSchema.parse(raw);
  if (sample.items.some((thread) => thread.snippet.videoId !== videoId))
    throw Error("Comment does not match the requested entity");
  return sample;
}
const videoSchema = z.object({
  id: z.string().min(1),
  snippet: z.object({
    title: z.string(),
    description: z.string(),
    publishedAt: z.iso.datetime({ offset: true }),
    tags: z
      .array(z.string())
      .nullable()
      .optional()
      .transform((value) => value ?? null),
    defaultLanguage: optionalText,
    defaultAudioLanguage: optionalText,
    liveBroadcastContent: z
      .enum(["none", "live", "upcoming"])
      .nullable()
      .optional()
      .transform((value) => value ?? null),
  }),
  contentDetails: z.object({ duration: z.string() }),
  commentThreads: commentThreadsSchema.optional(),
});

// YouTube emits ISO 8601 elapsed durations; calendar years/months have no fixed seconds.
export function durationSeconds(duration: string): number {
  const match =
    /^P(?:(\d+)W|(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?)$/.exec(
      duration,
    );
  if (
    !match ||
    !match.slice(1).some((value) => value !== undefined) ||
    duration.endsWith("T")
  )
    throw Error("Malformed video duration");
  const seconds =
    Number(match[1] ?? 0) * 604800 +
    Number(match[2] ?? 0) * 86400 +
    Number(match[3] ?? 0) * 3600 +
    Number(match[4] ?? 0) * 60 +
    Number(match[5] ?? 0);
  if (!Number.isSafeInteger(Math.ceil(seconds)))
    throw Error("Invalid video duration");
  return seconds;
}

export function mapYouTubePayload(raw: unknown, videoId: string) {
  const item = videoSchema.parse(raw);
  if (item.id !== videoId)
    throw Error("Video does not match the requested entity");
  if (item.commentThreads)
    validateYouTubeComments(item.commentThreads, videoId);
  const filtered = {
    ...item.snippet,
    duration: item.contentDetails.duration,
    durationSeconds: durationSeconds(item.contentDetails.duration),
    comments: {
      status: item.commentThreads?.status ?? "unavailable",
      order: "relevance" as const,
      items: (item.commentThreads?.items ?? []).map((thread) => ({
        text: thread.snippet.topLevelComment.snippet.textDisplay,
        publishedAt: thread.snippet.topLevelComment.snippet.publishedAt,
        updatedAt: thread.snippet.topLevelComment.snippet.updatedAt,
      })),
    },
  };
  if (
    Buffer.byteLength(JSON.stringify(filtered, null, 2), "utf8") >
    MAX_FILTERED_BYTES
  )
    throw Error("Filtered video exceeds input size limit");
  return filtered;
}
export type FilteredYouTubeVideo = ReturnType<typeof mapYouTubePayload>;
