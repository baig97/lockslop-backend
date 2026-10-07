import { aiSignalKeys } from "../lib/contracts/overview";
type Key = (typeof aiSignalKeys)[number];
export type EvaluationFixture = {
  name: string;
  title: string;
  description: string;
  language?: string;
  expected: Record<Key, readonly [number, number]>;
  rationale: string;
};
const low = {
  repetitive: [0, 0.35],
  clickbait: [0, 0.35],
  low_information_density: [0, 0.35],
  ai_generated_filler: [0, 0.35],
  copied_or_repackaged: [0, 0.35],
} as const;
// Human-assigned broad evidence ranges, not truth labels or calibrated probabilities.
export const evaluationFixtures: EvaluationFixture[] = [
  {
    name: "clean educational",
    title: "How a bicycle brake works",
    description:
      "We demonstrate cable tension and pad alignment. At 00:40 inspect the cable; at 02:10 adjust the pads. The demonstration compares stopping distances and explains limitations. Filmed and checked by our workshop.",
    expected: low,
    rationale:
      "Specific helpful detail; no supporting evidence for any signal.",
  },
  {
    name: "promotional title",
    title:
      "THE SECRET CURE doctors HIDE! Guaranteed to cure EVERY disease overnight!",
    description:
      "Guaranteed cure for every disease overnight. Buy our secret cure now. No exceptions and no evidence needed; everyone is guaranteed to be cured.",
    expected: { ...low, clickbait: [0.65, 1] },
    rationale:
      "Repeated absolute manipulative medical promises support clickbait; this is not a factuality assessment.",
  },
  {
    name: "repetitive filler",
    title: "Amazing things await",
    description:
      "Amazing things await. Amazing things await. We will reveal amazing things. Amazing things await. You will learn amazing things. Amazing things await. Amazing things await. We will reveal amazing things.",
    expected: {
      ...low,
      repetitive: [0.65, 1],
      low_information_density: [0.55, 1],
    },
    rationale:
      "Substantive promotional repetition with no detail; AI use and unseen video repetition remain unknown.",
  },
  {
    name: "legitimate credited commentary",
    title: "A critical comparison of two bridge designs",
    description:
      "Clips used with permission from the original engineer, credited at https://youtube.com/watch?v=abcdefghijk. Our original commentary compares force distribution, explains three design tradeoffs and includes our own measured load tests.",
    expected: low,
    rationale:
      "Credits and licensed clips plus substantive commentary are not problematic copying.",
  },
  {
    name: "AI-assisted quality",
    title: "Understanding orbital mechanics",
    description:
      "AI assisted with drafting diagrams. An aerospace instructor corrected and reviewed every explanation. We derive circular orbital velocity, show calculations with units, compare numerical results and discuss assumptions and sources of error.",
    expected: low,
    rationale:
      "Explicit AI disclosure accompanied by useful reviewed substance does not establish filler.",
  },
  {
    name: "sparse metadata",
    title: "Notes",
    description: "",
    expected: low,
    rationale:
      "Unavailable information is no supporting evidence; do not fill gaps with assumptions.",
  },
  {
    name: "non-English explanation",
    title: "سائیکل کے بریک کیسے کام کرتے ہیں",
    description:
      "اس ویڈیو میں کیبل کی کھنچاؤ اور بریک پیڈ کی سیدھ کی عملی وضاحت ہے۔ پہلے کیبل کو چیک کریں، پھر پیڈ کو درست کریں۔ ہم دو طریقوں کا موازنہ اور ان کی حدود بتاتے ہیں۔",
    language: "ur",
    expected: low,
    rationale:
      "Specific explanation in Urdu; unfamiliar language must not become AI or quality evidence.",
  },
];
export function fixtureContent(fixture: (typeof evaluationFixtures)[number]) {
  return {
    schemaVersion: 2 as const,
    title: fixture.title,
    description: fixture.description,
    publishedAt: "2026-01-01T00:00:00Z",
    durationSeconds: 240,
    languageHint: null,
    liveBroadcastContent: null,
    tags: [],
    counts: { comments: null, views: null, likes: null },
    comments: { status: "unavailable" as const, items: [] },
  };
}
