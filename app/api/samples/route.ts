import samples from "@/data/samples.json";
export async function GET() {
  return Response.json({ samples });
}
