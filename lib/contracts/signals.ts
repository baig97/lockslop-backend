/** Canonical identities live in one database table; platform membership lives here. */
export const signalKeys = [
  "repetitive",
  "clickbait",
  "low_information_density",
  "ai_generated_filler",
  "copied_or_repackaged",
  "engagement_bait",
  "incoherent_reasoning",
] as const;
export type SignalKey = (typeof signalKeys)[number];
export type SignalEntityType = "youtube_video" | "linkedin_post";
export const youtubeSignalKeys = [
  "repetitive",
  "clickbait",
  "low_information_density",
  "ai_generated_filler",
  "copied_or_repackaged",
] as const satisfies readonly SignalKey[];
export const linkedinSignalKeys = [
  "low_information_density",
  "repetitive",
  "clickbait",
  "copied_or_repackaged",
  "ai_generated_filler",
  "engagement_bait",
  "incoherent_reasoning",
] as const satisfies readonly SignalKey[];
export const PLATFORM_SIGNAL_KEYS = {
  youtube_video: youtubeSignalKeys,
  linkedin_post: linkedinSignalKeys,
} as const;
export function signalsFor(type: SignalEntityType): readonly SignalKey[] {
  return PLATFORM_SIGNAL_KEYS[type];
}
export function completeSignalSet(
  type: SignalEntityType,
  signals: readonly { key: string }[],
): boolean {
  const expected = signalsFor(type);
  return (
    signals.length === expected.length &&
    expected.every((key) => signals.filter((s) => s.key === key).length === 1)
  );
}
export const SIGNAL_LABELS: Record<SignalKey, string> = {
  repetitive: "Repetitive",
  clickbait: "Clickbait",
  low_information_density: "Little substance",
  ai_generated_filler: "AI-generated filler",
  copied_or_repackaged: "Copied or repackaged",
  engagement_bait: "Engagement bait",
  incoherent_reasoning: "Disconnected reasoning",
};
const youtubeDescriptions = {
  repetitive: "The same points, over and over",
  clickbait: "The title promises more than the video delivers",
  low_information_density: "Lots of runtime, little useful information",
  ai_generated_filler: "Synthetic content without much added value",
  copied_or_repackaged: "Someone else’s work with little added value",
};
const linkedinDescriptions: Record<SignalKey, string> = {
  repetitive: "The same point repeated without developing it",
  clickbait: "Dramatic promises unsupported by the post",
  low_information_density:
    "Vague advice or buzzwords with little meaningful detail",
  ai_generated_filler: "AI-produced filler with little useful contribution",
  copied_or_repackaged: "Reused material with little original contribution",
  engagement_bait:
    "Requests for reactions or comments instead of meaningful discussion",
  incoherent_reasoning:
    "Disconnected claims, contradictions or conclusions that do not follow",
};
export function signalDefinitionsFor(type: SignalEntityType) {
  return signalsFor(type).map((key) => ({
    key,
    label: SIGNAL_LABELS[key],
    description:
      type === "linkedin_post"
        ? linkedinDescriptions[key]
        : youtubeDescriptions[key as keyof typeof youtubeDescriptions],
  }));
}
