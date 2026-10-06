# Jev metadata formulation evaluation

Run: 2026-10-05. Model: `jev-1.13.0`. Formulation: `youtube-metadata-v1`.

Seven synthetic metadata fixtures were evaluated through the real TypeSafe API, with all five questions batched per fixture. Human-assigned ranges were recorded before inference and have not been changed to fit the outputs. All responses passed the complete five-score contract. This is a diagnostic sample, not a measurement of detection accuracy or calibrated probabilities.

| Fixture | Repetitive | Clickbait | Low information | AI filler | Copied/repackaged | Deviations |
|---|---:|---:|---:|---:|---:|---|
| Clean educational | 0 | .0025 | .0025 | 0 | 0 | None |
| Promotional title | .9525 | .9875 | .905 | .0225 | 0 | Repetitive and low information exceeded the expected low ranges |
| Repetitive filler | .985 | .415 | .92 | .12 | .0025 | Clickbait exceeded the expected low range |
| Legitimate credited commentary | .0025 | .035 | .01 | 0 | .015 | None |
| AI-assisted quality | .0025 | 0 | .0025 | .0025 | 0 | None |
| Sparse metadata | 0 | 0 | .01 | 0 | 0 | None |
| Non-English explanation | .005 | .0025 | .015 | 0 | 0 | None |

The promotional fixture repeats absolute cure promises without substance; the two additional high scores have observable support under the rubric, suggesting its human expectations deserve review. The repetitive fixture's vague promises produced moderate clickbait evidence (.415), below the extension's .65 display threshold. This may reflect overlap between promotional promises and manipulative framing; investigate on more examples before changing the formulation or human baseline. Do not infer independent validation from these observations.

Re-run `npm run eval:jev` after formulation/model changes. It reports deviations without asserting exact model values. The live overview smoke test separately verified actual provider inference, five persisted scores, unchanged payload revision and warm-cache reuse. Its temporary records were cleaned.

## Critique revision: v1 versus v2

Run: 2026-10-05. Same pinned model (`jev-1.13.0`), same seven fixtures and unchanged expected ranges. The revised formulation (`youtube-metadata-v2`) uses structured task/signal/evidence-scope instructions and criteria with separate evidence/uncertainty fields. Definitions are no longer repeated in each level. AI filler explicitly requires both observable filler and explicit AI-use evidence; reuse targets little original contribution without inferring ownership/infringement. Shared field and modality safeguards remain in the context.

Deferred architectural suggestions: splitting AI use and filler into independent outputs, introducing an evidence-coverage metric, and persisting/exposing confidence or probability distributions. Existing five-score persistence, DTO and frontend display threshold remain unchanged. At the time of this historical run, versioning invalidated v1 cache entries; the later one-month TTL policy below supersedes that behavior.

All values below are normalized evidence strength, shown as **v1 → v2**.

| Fixture | Repetitive | Clickbait | Low information | AI filler | Copied/repackaged | Deviations v1 → v2 |
|---|---:|---:|---:|---:|---:|---:|
| clean educational | 0 → 0 | 0.0025 → 0.0025 | 0.0025 → 0.0025 | 0 → 0 | 0 → 0 | 0 → 0 |
| promotional title | 0.9525 → 0.77 | 0.9875 → 0.9775 | 0.905 → 0.9225 | 0.0225 → 0.025 | 0 → 0.0025 | 2 → 2 |
| repetitive filler | 0.985 → 0.9425 | 0.415 → 0.53 | 0.92 → 0.895 | 0.12 → 0.095 | 0.0025 → 0.005 | 1 → 1 |
| legitimate credited commentary | 0.0025 → 0 | 0.035 → 0.01 | 0.01 → 0.005 | 0 → 0 | 0.015 → 0.04 | 0 → 0 |
| AI-assisted quality | 0.0025 → 0.0025 | 0 → 0 | 0.0025 → 0.0025 | 0.0025 → 0.0125 | 0 → 0.0025 | 0 → 0 |
| sparse metadata | 0 → 0 | 0 → 0 | 0.01 → 0.02 | 0 → 0 | 0 → 0 | 0 → 0 |
| non-English explanation | 0.005 → 0.0025 | 0.0025 → 0.0025 | 0.015 → 0.005 | 0 → 0 | 0 → 0 | 0 → 0 |

Total expectation deviations stayed at **3 → 3** across 35 signal evaluations. The same two promotional-fixture deviations (repetitive and low information) and repetitive-fixture clickbait deviation remain. This run does **not** demonstrate improved agreement with the fixed expectations.

The largest changes were promotional repetition (.9525 → .77, −.1825) and repetitive-filler clickbait (.415 → .53, +.115). Promotional clickbait remained high (.9875 → .9775), as did repetitive-filler repetition (.985 → .9425) and low information (.92 → .895). All five counterexample fixtures retained scores below .35. The extension's .65 display choices are unchanged across all seven fixtures: the elevated repetitive-filler clickbait score is still below the display threshold.

These are two historical single-run observations, not a controlled estimate of formulation improvement; model variability is not isolated. Expectations were not adjusted after seeing outputs. The promotional fixture's other high signals have visible support in its repeated, content-free promises, while the repetitive fixture's clickbait score continues to indicate boundary overlap requiring broader examples before rubric tuning.

Reported input tokens averaged 3682.1 → 3199.1 per fixture (-13.1%). This reflects less repeated formulation text, not a quality or accuracy metric.

## English-gated evaluation and one-month cache policy

The overview now keeps complete scores matching the payload revision for one calendar month, regardless of generator version. After expiry, it regenerates the complete set synchronously using the saved ready payload; failures do not publish expired scores. Before serving cached scores or starting Jev, `franc` 6.2.0 checks the full title plus description. Only `eng` proceeds. Other codes return the typed `unsupported_language` state; undetermined text uses `und`. No schema migration was required.

Re-running the seven fixtures produced four live evaluations and three skips:

| Fixture | Language gate | Outcome |
|---|---|---|
| Clean educational | English | Evaluated; no expectation deviations |
| Promotional title | English | Evaluated; repetitive and low-information deviations remain |
| Repetitive filler | Scots (`sco`) | Skipped, despite this synthetic text being English |
| Legitimate credited commentary | English | Evaluated; no expectation deviations |
| AI-assisted quality | English | Evaluated; no expectation deviations |
| Sparse metadata | Undetermined (`und`) | Skipped |
| Non-English explanation | Urdu (`urd`) | Skipped |

Among the four evaluated fixtures, deviations were 2 against 2 in the recorded v1 baseline **for those same four fixtures**. The three skips are exclusions, not zero-score successes; the total is not directly comparable with earlier all-seven evaluation runs. The English repetitive fixture demonstrates that the requested strict `franc(text) === "eng"` heuristic can reject repetitive English text. The UI says English was not detected rather than asserting a video's actual language. Full run output is recorded in `guides/jev-evaluation-language.json`.
