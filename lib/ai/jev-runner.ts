import { z } from "zod";
import { JEV_MODEL, GENERATOR_VERSION, pinnedModel } from "./config";

export type ScoreDescription = string | Record<string, string>;
export type ScoreQuestion = {
  type: "score";
  instructions: ScoreDescription;
  criteria: ScoreDescription[];
};
export type JevFailureCategory =
  | "configuration"
  | "authentication"
  | "request_validation"
  | "provider_unavailable"
  | "invalid_response"
  | "timeout"
  | "transport";
export class JevError extends Error {
  constructor(public readonly category: JevFailureCategory) {
    super(`Jev evaluation failed: ${category}`);
  }
}
const answerSchema = z.object({
  type: z.literal("score"),
  score: z.number().finite().min(0).max(4),
});
const responseSchema = z.object({
  model: z.string(),
  answers: z.record(z.string(), answerSchema),
  usage: z.object({
    input_tokens: z.number().int().nonnegative(),
    output_tokens: z.number().int().nonnegative(),
  }),
});
const descriptionSchema = z.union([
  z.string().min(1),
  z
    .record(z.string().min(1), z.string().min(1))
    .refine((value) => Object.keys(value).length > 0),
]);
const questionSchema = z.record(
  z.string(),
  z.object({
    type: z.literal("score"),
    instructions: descriptionSchema,
    criteria: z.array(descriptionSchema).length(5),
  }),
);
const retryable = new Set([429, 529, 502, 503, 504]);
export function retryDelay(header: string | null, now: number): number {
  if (header === null) return 200;
  const seconds = Number(header);
  if (header.trim() && Number.isFinite(seconds) && seconds >= 0)
    return seconds * 1000;
  const date = Date.parse(header);
  return Number.isFinite(date) ? Math.max(0, date - now) : 200;
}

type RunnerOptions = {
  apiKey?: string;
  model?: string;
  fetch?: typeof fetch;
  deadlineMs?: number;
  log?: (event: Record<string, unknown>) => void;
};
// Entity-agnostic transport. No mapper, raw provider input or persistence dependencies.
export async function runJev<Key extends string>(
  state: string,
  questions: Record<Key, ScoreQuestion>,
  options: RunnerOptions = {},
): Promise<{ key: Key; score: number }[]> {
  const started = Date.now();
  const model = options.model ?? JEV_MODEL;
  const log = options.log ?? ((event) => console.info("Jev evaluation", event));
  const controller = new AbortController();
  const budget = Math.min(options.deadlineMs ?? 5000, 5000);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const metadata = () => ({
    model,
    version: GENERATOR_VERSION,
    durationMs: Date.now() - started,
  });
  try {
    try {
      pinnedModel(model);
    } catch {
      throw new JevError("configuration");
    }
    const apiKey = options.apiKey ?? process.env.TYPESAFE_API_KEY;
    if (!apiKey?.trim()) throw new JevError("configuration");
    if (
      !questionSchema.safeParse(questions).success ||
      !Object.keys(questions).length ||
      budget <= 0
    )
      throw new JevError("request_validation");
    const send = options.fetch ?? globalThis.fetch;
    const keys = Object.keys(questions) as Key[];
    const deadline = started + budget;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => {
          controller.abort();
          reject(new JevError("timeout"));
        },
        Math.max(0, deadline - Date.now()),
      );
    });
    const execute = async () => {
      for (let attempt = 0; attempt < 2; attempt++) {
        controller.signal.throwIfAborted();
        const response = await send("https://api.typesafe.ai/v1/systemone", {
          method: "POST",
          cache: "no-store",
          signal: controller.signal,
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ state, model, questions }),
        });
        if (!response.ok) {
          const delay = retryDelay(
            response.headers.get("Retry-After"),
            Date.now(),
          );
          if (
            attempt === 0 &&
            retryable.has(response.status) &&
            delay < deadline - Date.now()
          ) {
            await response.body?.cancel();
            await new Promise<void>((resolve, reject) => {
              const onAbort = () => {
                clearTimeout(wait);
                reject(new JevError("timeout"));
              };
              const wait = setTimeout(() => {
                controller.signal.removeEventListener("abort", onAbort);
                resolve();
              }, delay);
              controller.signal.addEventListener("abort", onAbort, {
                once: true,
              });
              if (controller.signal.aborted) onAbort();
            });
            continue;
          }
          await response.body?.cancel();
          throw new JevError(
            response.status === 401 || response.status === 403
              ? "authentication"
              : response.status === 422 || response.status === 400
                ? "request_validation"
                : "provider_unavailable",
          );
        }
        let raw: unknown;
        try {
          raw = await response.json();
        } catch {
          throw new JevError("invalid_response");
        }
        const parsed = responseSchema.safeParse(raw);
        if (
          !parsed.success ||
          parsed.data.model !== model ||
          Object.keys(parsed.data.answers).length !== keys.length ||
          keys.some((key) => !Object.hasOwn(parsed.data.answers, key))
        )
          throw new JevError("invalid_response");
        controller.signal.throwIfAborted();
        const signals = keys.map((key) => ({
          key,
          score: parsed.data.answers[key].score / 4,
        }));
        return { signals, usage: parsed.data.usage };
      }
      throw new JevError("provider_unavailable");
    };
    const { signals, usage } = await Promise.race([execute(), timeout]);
    log({ ...metadata(), status: "ready", usage });
    return signals;
  } catch (error) {
    const failure = controller.signal.aborted
      ? new JevError("timeout")
      : error instanceof JevError
        ? error
        : new JevError("transport");
    log({ ...metadata(), status: "unavailable", category: failure.category });
    throw failure;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
