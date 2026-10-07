import { franc } from "franc";
import type { DerivedContent } from "../contracts/content";
export function isEnglish(text: string) {
  return franc(text) === "eng";
}
export function checkContentLanguage(input: DerivedContent) {
  const detectedLanguage = franc(
    `${"description" in input ? input.title + "\n" + input.description : input.text}`.trim(),
  );
  return detectedLanguage === "eng"
    ? null
    : { status: "unsupported_language" as const, detectedLanguage };
}
