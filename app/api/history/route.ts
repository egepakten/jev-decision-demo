import { getRuns } from "@/lib/server";
export async function GET() {
  try {
    return Response.json(
      { runs: await getRuns() },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return Response.json(
      {
        runs: [],
        error: "Could not load records. Check the database setup.",
      },
      { status: 503 },
    );
  }
}
