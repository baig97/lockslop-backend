import { readFile } from "node:fs/promises";
import { config } from "dotenv";
config({ path: ".env.local", quiet: true });
const { deriveAiSignals, generationPool } = await import("../lib/ai-signals");
const { pool } = await import("../lib/db");
const { mapYouTubePayload } = await import("../lib/ai/youtube-video.mapper");
const { evaluationFixtures, fixtureResource } =
  await import("./evaluation-fixtures");
const { checkMetadataLanguage } = await import("../lib/ai/language");
const { FORMULATION_VERSION, JEV_MODEL } = await import("../lib/ai/config");
const baseline = JSON.parse(
  await readFile(
    new URL("./evaluation-baseline.json", import.meta.url),
    "utf8",
  ),
) as {
  formulation: string;
  model: string;
  fixtures: Record<string, Record<string, number>>;
};
let skipped = 0;
let evaluated = 0;
let deviations = 0;
let baselineDeviations = 0;
try {
  if (!process.env.TYPESAFE_API_KEY)
    throw Error("Set TYPESAFE_API_KEY before running live evaluation");
  for (const fixture of evaluationFixtures) {
    const input = mapYouTubePayload(fixtureResource(fixture), "abcdefghijk");
    const language = checkMetadataLanguage(input);
    if (language) {
      skipped++;
      console.log(
        JSON.stringify({
          fixture: fixture.name,
          ...language,
          evaluated: false,
          formulation: FORMULATION_VERSION,
          model: JEV_MODEL,
        }),
      );
      continue;
    }
    evaluated++;
    const signals = await deriveAiSignals(input);
    const outside = signals.filter(
      ({ key, score }) =>
        score < fixture.expected[key][0] || score > fixture.expected[key][1],
    );
    deviations += outside.length;
    const previous = baseline.fixtures[fixture.name];
    if (!previous) throw Error(`Missing baseline for fixture ${fixture.name}`);
    const oldOutside = signals.filter(
      ({ key }) =>
        previous[key] < fixture.expected[key][0] ||
        previous[key] > fixture.expected[key][1],
    );
    baselineDeviations += oldOutside.length;
    console.log(
      JSON.stringify({
        fixture: fixture.name,
        formulation: FORMULATION_VERSION,
        model: JEV_MODEL,
        baselineFormulation: baseline.formulation,
        baselineModel: baseline.model,
        signals,
        previous,
        delta: Object.fromEntries(
          signals.map(({ key, score }) => [
            key,
            Number((score - previous[key]).toFixed(6)),
          ]),
        ),
        previousDeviations: oldOutside.map(({ key }) => key),
        expected: fixture.expected,
        deviations: outside.map(({ key }) => key),
        rationale: fixture.rationale,
      }),
    );
  }
  console.log(
    `${deviations} deviations (previous: ${baselineDeviations}) across ${evaluated} evaluated unchanged human-assigned metadata rubrics; ${skipped} skipped by the English gate. Baseline deviation totals cover only evaluated fixtures. This is a formulation diagnostic, not calibrated detection accuracy.`,
  );
} finally {
  await generationPool.end();
  await pool.end();
}
