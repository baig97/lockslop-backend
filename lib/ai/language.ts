import { francAll } from "franc";
import type { DerivedContent } from "../contracts/content";

// These are ranking distances, not calibrated probabilities. Only resolve the
// close English/Scots ambiguity when the text also contains varied English words.
const ENGLISH_SCOTS_MAX_DISTANCE = 0.025;
const englishMarkers = new Set([
  "the",
  "this",
  "that",
  "what",
  "if",
  "and",
  "now",
  "until",
  "my",
  "your",
  "you",
  "can",
  "cannot",
  "finally",
  "some",
  "people",
  "thing",
  "things",
  "world",
  "after",
]);
function detectLanguage(text: string): string {
  const ranked = francAll(text.trim());
  const [first, second] = ranked;
  if (!first) return "und";
  if (
    first[0] === "sco" &&
    second?.[0] === "eng" &&
    first[1] - second[1] <= ENGLISH_SCOTS_MAX_DISTANCE
  ) {
    const words = text.toLowerCase().match(/\p{L}+/gu) ?? [];
    const markers = words.filter((word) => englishMarkers.has(word));
    if (new Set(markers).size >= 5 && markers.length / words.length >= 0.12)
      return "eng";
  }
  return first[0];
}
export function isEnglish(text: string) {
  return detectLanguage(text) === "eng";
}
export function checkContentLanguage(input: DerivedContent) {
  const text =
    "description" in input
      ? `${input.title}\n${input.description}`
      : input.text;
  const detectedLanguage = detectLanguage(text);
  return detectedLanguage === "eng"
    ? null
    : { status: "unsupported_language" as const, detectedLanguage };
}
