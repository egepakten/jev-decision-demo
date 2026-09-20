import fs from "node:fs";
const base = process.env.TEST_URL || "http://127.0.0.1:4173";
const { samples } = await (await fetch(base + "/api/samples")).json();
const selected = [...new Set(samples.map((s) => s.intent))].map((intent) =>
  samples.find((s) => s.intent === intent && s.split === "test"),
);
const runs = [];
for (const sample of selected) {
  const response = await fetch(base + "/api/run", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message: sample.text,
      sampleId: sample.id,
      compare: true,
    }),
  });
  const events = (await response.text()).trim().split("\n").map(JSON.parse);
  const saved = events.find((e) => e.stage === "saved");
  if (!saved) throw new Error("Run was not saved");
  runs.push(saved.run);
  console.log(
    sample.intent,
    saved.run.results
      .map((r) => r.provider + ": " + (r.error || r.intent))
      .join(" | "),
  );
  if (runs.length === 1 && saved.run.results.some((r) => r.error))
    throw new Error("Provider smoke check failed; stopping further calls");
}
const summary = ["jev", "gemini"].map((provider) => {
  const r = runs
    .flatMap((x) => x.results)
    .filter((x) => x.provider === provider);
  const times = r.map((x) => x.latencyMs).sort((a, b) => a - b);
  return {
    provider,
    model: r[0].model,
    transport: r[0].transport,
    total: r.length,
    correct: r.filter((x) => x.correct).length,
    teamCorrect: r.filter((x) => x.teamCorrect).length,
    errors: r.filter((x) => x.error).length,
    medianLatencyMs: times[Math.floor(times.length / 2)],
    costUsd: r.every((x) => typeof x.costUsd === "number")
      ? r.reduce((s, x) => s + x.costUsd, 0)
      : null,
  };
});
fs.mkdirSync("reports", { recursive: true });
fs.writeFileSync(
  "reports/comparison-results.json",
  JSON.stringify(
    {
      createdAt: new Date().toISOString(),
      method:
        "One held-out example per intent; identical messages and criteria; one request per provider per example; routing latency includes transport overhead. Small synthetic sample, not a general benchmark.",
      summary,
      runs,
    },
    null,
    2,
  ) + "\n",
);
console.log(JSON.stringify(summary, null, 2));
