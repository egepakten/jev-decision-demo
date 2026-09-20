import { setting } from "@/lib/server";
export async function GET() {
  return Response.json(
    {
      jev: Boolean(setting("TYPESAFE_API_KEY")),
      gemini: Boolean(
        setting("GEMINI_API_KEY") || setting("OPENROUTER_API_KEY"),
      ),
      jevModel: setting("JEV_MODEL") || "jev-1.13.0",
      geminiModel: setting("GEMINI_MODEL") || "gemini-2.5-flash-lite",
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
