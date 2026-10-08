import { franc } from "franc";
import type { DerivedContent } from "../contracts/content";

const sentences = new Intl.Segmenter("en", { granularity: "sentence" });
// Short fragments are noisy language samples. Keep the fallback to meaningful
// body segments; the full-text check still uses franc's existing default.
const MIN_SEGMENT_LETTERS = 30;
function hasEnglishSegment(body: string): boolean {
  const segments = new Set([
    body.trim(),
    ...body.split(/\r?\n/).map((segment) => segment.trim()),
    ...body.split(/\r?\n\s*\r?\n/).map((segment) => segment.trim()),
    ...Array.from(sentences.segment(body), (entry) => entry.segment.trim()),
  ]);
  return [...segments].some(
    (segment) =>
      (segment.match(/\p{L}/gu)?.length ?? 0) >= MIN_SEGMENT_LETTERS &&
      franc(segment) === "eng",
  );
}
export function isEnglish(text: string) {
  return franc(text.trim()) === "eng" || hasEnglishSegment(text);
}
export function checkContentLanguage(input: DerivedContent) {
  const body = "description" in input ? input.description : input.text;
  const fullText = "description" in input ? `${input.title}\n${body}` : body;
  const detectedLanguage = franc(fullText.trim());
  // Title, tags, comments and hints do not participate in the body fallback.
  return detectedLanguage === "eng" || hasEnglishSegment(body)
    ? null
    : { status: "unsupported_language" as const, detectedLanguage };
}
