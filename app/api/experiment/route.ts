import { evaluate, saveRun } from "@/lib/server";
import { variants, type Variant } from "@/lib/experiment";
export async function POST(request: Request) {
  if (
    request.headers.get("origin") &&
    request.headers.get("origin") !== new URL(request.url).origin
  )
    return Response.json({ error: "Origin rejected" }, { status: 403 });
  let b;
  try {
    const text = await request.text();
    if (text.length > 6000) throw Error();
    b = JSON.parse(text);
  } catch {
    return Response.json({ error: "Invalid request" }, { status: 400 });
  }
  if (
    typeof b.message !== "string" ||
    !b.message.trim() ||
    b.message.length > 4000 ||
    !variants.includes(b.variant as Variant)
  )
    return Response.json(
      { error: "Invalid message or variant" },
      { status: 400 },
    );
  const result = await evaluate(
    b.variant === "jev" ? "jev" : "gemini",
    b.message,
    { multi: true, thinking: b.variant === "gemini_on" },
  );
  try {
    await saveRun({
      id: crypto.randomUUID(),
      message: b.message,
      results: [result],
      createdAt: new Date().toISOString(),
    });
  } catch {
    return Response.json(
      { error: "Could not save experiment result." },
      { status: 500 },
    );
  }
  return Response.json(
    { result },
    { headers: { "Cache-Control": "no-store" } },
  );
}
