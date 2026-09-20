import {
  questions as decisionQuestions,
  fields,
  type Decisions,
} from "./experiment";
import { env } from "cloudflare:workers";
import {
  criteria,
  instructions,
  intents,
  type ModelResult,
  type SavedRun,
} from "./routing";
export function setting(name: string) {
  return (
    (env as unknown as Record<string, string>)[name] || process.env[name] || ""
  );
}
export function db() {
  if (!env.DB) throw new Error("Database connection is not ready.");
  return env.DB;
}
export async function saveRun(run: SavedRun) {
  await db()
    .prepare("INSERT INTO runs (id, created_at, payload) VALUES (?, ?, ?)")
    .bind(run.id, run.createdAt, JSON.stringify(run))
    .run();
}
export async function getRuns() {
  const { results } = await db()
    .prepare("SELECT payload FROM runs ORDER BY created_at DESC LIMIT 100")
    .all<{ payload: string }>();
  return results.map((r) => JSON.parse(r.payload) as SavedRun);
}
export async function evaluate(
  provider: "jev" | "gemini",
  message: string,
  options: { multi?: boolean; thinking?: boolean } = {},
): Promise<ModelResult> {
  const thinking = options.thinking ?? true;
  const questions = options.multi
    ? decisionQuestions
    : { intent: { type: "choice", instructions, criteria } };
  const definitions = JSON.stringify(questions);
  const properties = Object.fromEntries(
    Object.entries(questions).map(([key, q]) => [
      key,
      { type: "string", enum: Object.keys(q.criteria) },
    ]),
  );
  const required = Object.keys(properties);
  const started = performance.now();
  const openrouter =
    provider === "gemini" && Boolean(setting("OPENROUTER_API_KEY"));
  const model =
    setting(provider === "jev" ? "JEV_MODEL" : "GEMINI_MODEL") ||
    (provider === "jev" ? "jev-1.13.0" : "gemini-2.5-flash-lite");
  const key = setting(
    provider === "jev"
      ? "TYPESAFE_API_KEY"
      : openrouter
        ? "OPENROUTER_API_KEY"
        : "GEMINI_API_KEY",
  );
  const base = { provider, model, latencyMs: 0 };
  if (!key)
    return {
      ...base,
      error:
        provider === "jev"
          ? "Jev key is not configured."
          : "Gemini key is not configured.",
    };
  try {
    const request: {
      url: string;
      headers: Record<string, string>;
      body: unknown;
    } =
      provider === "jev"
        ? {
            url: "https://api.typesafe.ai/v1/systemone",
            headers: {
              "Content-Type": "application/json",
              Authorization: "Bearer " + key,
            },
            body: {
              model,
              state: { customer_message: message },
              questions,
            },
          }
        : openrouter
          ? {
              url: "https://openrouter.ai/api/v1/chat/completions",
              headers: {
                "Content-Type": "application/json",
                Authorization: "Bearer " + key,
              },
              body: {
                model: model.startsWith("google/") ? model : "google/" + model,
                messages: [
                  {
                    role: "system",
                    content:
                      "Answer every question using its instructions and criteria. Return one JSON object. Definitions: " +
                      definitions,
                  },
                  {
                    role: "user",
                    content: JSON.stringify({ customer_message: message }),
                  },
                ],
                temperature: 0,
                max_tokens: 2048,
                reasoning: thinking
                  ? { enabled: true, max_tokens: 1024, exclude: true }
                  : { enabled: false },
                response_format: {
                  type: "json_schema",
                  json_schema: {
                    name: "routing_intent",
                    strict: true,
                    schema: {
                      type: "object",
                      properties,
                      required,
                      additionalProperties: false,
                    },
                  },
                },
                provider: { require_parameters: true },
              },
            }
          : {
              url:
                "https://generativelanguage.googleapis.com/v1beta/models/" +
                encodeURIComponent(model) +
                ":generateContent",
              headers: {
                "Content-Type": "application/json",
                "x-goog-api-key": key,
              },
              body: {
                systemInstruction: {
                  parts: [
                    {
                      text:
                        "Answer every question using its instructions and criteria. Return one JSON object. Definitions: " +
                        definitions,
                    },
                  ],
                },
                contents: [
                  {
                    role: "user",
                    parts: [
                      { text: JSON.stringify({ customer_message: message }) },
                    ],
                  },
                ],
                generationConfig: {
                  temperature: 0,
                  thinkingConfig: { thinkingBudget: thinking ? 1024 : 0 },
                  maxOutputTokens: 2048,
                  responseMimeType: "application/json",
                  responseSchema: {
                    type: "OBJECT",
                    properties: Object.fromEntries(
                      Object.entries(properties).map(([k, v]) => [
                        k,
                        { ...v, type: "STRING" },
                      ]),
                    ),
                    required,
                  },
                },
              },
            };
    const res = await fetch(request.url, {
      method: "POST",
      headers: request.headers,
      body: JSON.stringify(request.body),
      signal: AbortSignal.timeout(30000),
    });
    if (!res.ok) {
      return {
        ...base,
        latencyMs: performance.now() - started,
        error: `${provider === "jev" ? "Jev" : "Gemini"} request failed (${res.status}).`,
      };
    }
    const data = (await res.json()) as Record<string, any>;
    let intent: string;
    let decisions: Decisions | undefined;
    let inputTokens: number | undefined;
    let outputTokens: number | undefined;
    let reasoningTokens: number | undefined;
    let confidence: number | undefined;
    let probabilities: Record<string, number> | undefined;
    if (provider === "jev") {
      const answer = data.answers?.intent;
      intent = answer?.choice;
      if (options.multi)
        decisions = Object.fromEntries(
          fields.map((f) => [f, data.answers?.[f]?.choice]),
        ) as Decisions;
      inputTokens = data.usage?.input_tokens;
      outputTokens = data.usage?.output_tokens;
      confidence = answer?.confidence;
      probabilities = answer?.probabilities;
      if (
        typeof confidence !== "number" ||
        confidence < 0 ||
        confidence > 1 ||
        !probabilities ||
        Object.values(probabilities).some(
          (v) => typeof v !== "number" || v < 0 || v > 1,
        )
      )
        throw new Error("invalid");
    } else if (openrouter) {
      const parsed = JSON.parse(data.choices?.[0]?.message?.content || "");
      intent = parsed.intent;
      if (options.multi) decisions = parsed;
      inputTokens = data.usage?.prompt_tokens;
      outputTokens = data.usage?.completion_tokens;
      reasoningTokens = data.usage?.completion_tokens_details?.reasoning_tokens;
    } else {
      const text = (data.candidates?.[0]?.content?.parts || [])
        .filter((p: any) => !p.thought)
        .map((p: any) => p.text || "")
        .join("");
      const parsed = JSON.parse(text);
      intent = parsed.intent;
      if (options.multi) decisions = parsed;
      reasoningTokens = data.usageMetadata?.thoughtsTokenCount;
      inputTokens = data.usageMetadata?.promptTokenCount;
      outputTokens =
        (data.usageMetadata?.candidatesTokenCount ?? 0) +
        (data.usageMetadata?.thoughtsTokenCount ?? 0);
    }
    if (typeof intent !== "string" || !Object.hasOwn(intents, intent))
      throw new Error("invalid");
    if (
      options.multi &&
      (!decisions ||
        fields.some(
          (f) => !Object.hasOwn(decisionQuestions[f].criteria, decisions![f]),
        ))
    )
      throw new Error("Invalid decisions");
    const resolvedModel =
      provider === "jev" || openrouter
        ? data.model || model
        : data.modelVersion || model;
    const costUsd = openrouter
      ? typeof data.usage?.cost === "number" &&
        Number.isFinite(data.usage.cost) &&
        data.usage.cost >= 0
        ? data.usage.cost
        : undefined
      : typeof inputTokens === "number"
        ? provider === "jev" && resolvedModel === "jev-1.13.0"
          ? (inputTokens * 0.042) / 1e6
          : provider === "gemini" && model === "gemini-2.5-flash-lite"
            ? (inputTokens * 0.1 + (outputTokens ?? 0) * 0.4) / 1e6
            : undefined
        : undefined;
    return {
      provider,
      model: resolvedModel,
      ...(provider === "gemini"
        ? { reasoningBudget: thinking ? 1024 : 0, reasoningTokens }
        : {}),
      transport: openrouter ? "openrouter" : "direct",
      intent,
      decisions,
      team: intents[intent].team,
      confidence,
      probabilities,
      latencyMs: performance.now() - started,
      inputTokens,
      outputTokens,
      costUsd,
    };
  } catch {
    return {
      ...base,
      latencyMs: performance.now() - started,
      error:
        "Could not receive or validate the model response. Please try again.",
    };
  }
}
