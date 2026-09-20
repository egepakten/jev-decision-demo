import { evaluate, saveRun, setting } from "@/lib/server";
import samples from "@/data/samples.json";
import { intents, type SavedRun } from "@/lib/routing";
export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin)
    return Response.json(
      { error: "Request origin was not accepted." },
      { status: 403 },
    );
  let body;
  try {
    const raw = await request.text();
    if (raw.length > 20000)
      return Response.json({ error: "Message is too long." }, { status: 413 });
    body = JSON.parse(raw);
  } catch {
    return Response.json({ error: "Invalid request." }, { status: 400 });
  }
  if (
    typeof body.message !== "string" ||
    !body.message.trim() ||
    body.message.length > 4000
  )
    return Response.json(
      { error: "Enter a message between 1 and 4000 characters." },
      { status: 400 },
    );
  if (body.compare !== undefined && typeof body.compare !== "boolean")
    return Response.json(
      { error: "Invalid comparison option." },
      { status: 400 },
    );
  if (!setting("TYPESAFE_API_KEY"))
    return Response.json(
      { error: "Jev key is not configured yet." },
      { status: 503 },
    );
  const message = body.message.trim();
  const sample = samples.find(
    (s) => s.id === body.sampleId && s.text.trim() === message,
  );
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      let open = true;
      const emit = (data: unknown) => {
        if (open)
          try {
            controller.enqueue(encoder.encode(JSON.stringify(data) + "\n"));
          } catch {
            open = false;
          }
      };
      try {
        emit({ stage: "received", label: "Message received" });
        emit({ stage: "evaluating", label: "Model request sent" });
        const providers: ("jev" | "gemini")[] = body.compare
          ? ["jev", "gemini"]
          : ["jev"];
        const results = await Promise.all(
          providers.map((p) => evaluate(p, message)),
        );
        for (const result of results) {
          if (sample) {
            result.correct = !result.error && result.intent === sample.intent;
            result.teamCorrect =
              !result.error && result.team === intents[sample.intent].team;
          }
        }
        emit({
          stage: "evaluated",
          label: "Model responses processed",
          results,
        });
        const run: SavedRun = {
          id: crypto.randomUUID(),
          message,
          sampleId: sample?.id,
          expected: sample?.intent,
          results,
          createdAt: new Date().toISOString(),
        };
        emit({ stage: "saving", label: "Saving results" });
        try {
          await saveRun(run);
          emit({
            stage: results[0].error ? "error" : "saved",
            label: "Database write confirmed",
            run,
            ...(results[0].error ? { error: results[0].error } : {}),
          });
        } catch {
          emit({
            stage: "error",
            error:
              "Model response received, but saving failed. Assignment was not completed.",
          });
        }
      } catch {
        emit({ stage: "error", error: "Could not complete the request." });
      } finally {
        if (open) controller.close();
      }
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
