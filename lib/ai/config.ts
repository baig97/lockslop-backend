export const FORMULATION_VERSION = "platform-content-v2";
export function pinnedModel(value = process.env.JEV_MODEL ?? "jev-1.13.0") {
  if (!/^jev-\d+\.\d+\.\d+$/.test(value))
    throw Error("JEV_MODEL must be a pinned versioned model ID");
  return value;
}
export const JEV_MODEL = pinnedModel();
export const GENERATOR_VERSION = `${FORMULATION_VERSION}:${JEV_MODEL}`;

export function generatorVersion(type: "youtube_video" | "linkedin_post") {
  return type === "youtube_video"
    ? GENERATOR_VERSION
    : `linkedin-signals-v1:${JEV_MODEL}`;
}
