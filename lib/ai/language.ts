import { franc } from "franc";
import type { FilteredYouTubeVideo } from "./youtube-video.mapper";
import type { AiResult } from "../contracts/overview";

export function isEnglish(text: string): boolean {
  return franc(text) === "eng";
}
export function checkMetadataLanguage(
  input: FilteredYouTubeVideo,
): Extract<AiResult, { status: "unsupported_language" }> | null {
  // Use the full substantive text, never tags or provider language hints as overrides.
  const detectedLanguage = franc(`${input.title}\n${input.description}`.trim());
  return detectedLanguage === "eng"
    ? null
    : { status: "unsupported_language", detectedLanguage };
}
