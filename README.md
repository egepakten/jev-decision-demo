# Jev Decision Demo

**A small experiment in structured AI decisions, illustrated with customer-support messages.**

Route Lab is a local, interactive comparison of **TypeSafe AI Jev** and **Gemini 2.5 Flash-Lite**, with Gemini thinking enabled and disabled. Clone or fork it, add your own API keys, and measure the behavior on the same messages and evaluation policy.

A message such as “My parcel says delivered, but I haven't received it” is evaluated for:

| Decision | What it means |
| --- | --- |
| Intent | What is the customer asking for? |
| Urgency | Is there an explicit urgent trigger? |
| Missing information | Is essential information missing for the next action? |
| Human review | Does the request meet the demo's escalation policy? |

All four questions are included in **one request per model setting**. The application maps the selected intent to Orders, Shipping, Returns, Payments, or a review queue. Owners are fictional; this demo does not change Shopify orders or issue refunds.

## Why Jev?

Jev is designed for structured decisions that software can use directly. TypeSafe describes its output mechanism as parallel sampling of typed decisions and probabilities, rather than autoregressive text generation. See the [official Jev introduction](https://typesafe.ai/blog/introducing-system-one-models-and-jev).

That makes support routing, triage, eligibility checks and workflow branching useful applications to explore. General-purpose models such as Gemini can perform these tasks too. This project measures the practical trade-offs rather than assuming one model always wins. A valid output type does not guarantee a correct business decision.

There are **two distinct forms of parallelism** here:

1. Jev receives all four questions together for parallel structured evaluation.
2. Route Lab launches Jev, Gemini thinking off and Gemini thinking on concurrently for each message. Gemini receives the same four definitions in a structured-output request; this does not imply it uses Jev's internal inference mechanism.

The current configuration uses Jev `jev-1.13.0` and Gemini `google/gemini-2.5-flash-lite` through OpenRouter. Thinking on requests a maximum budget of 1,024 thinking tokens. Model availability and pricing can change; actual response model IDs and usage are recorded.

## Quick start

Requirements: Node.js **22.13+**, npm, a TypeSafe API key, and an OpenRouter API key with access to the configured Gemini model. Alternatively, use a Google Gemini API key for the direct Google route.

```bash
git clone https://github.com/egepakten/jev-decision-demo.git
cd jev-decision-demo
npm ci
cp .env.example .env.local
```

Edit `.env.local`:

```dotenv
TYPESAFE_API_KEY=your_typesafe_key
OPENROUTER_API_KEY=your_openrouter_key
JEV_MODEL=jev-1.13.0
GEMINI_MODEL=gemini-2.5-flash-lite
```

OpenRouter takes precedence when both OpenRouter and Google keys are present. For direct Google, leave `OPENROUTER_API_KEY` empty and set `GEMINI_API_KEY`. Keys stay on the server; restart after changing them.

Build once and initialize the local database:

```bash
npm run build
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0000_overrated_daimon_hellstrom.sql
npx vite --host 127.0.0.1 --port 4173 --strictPort
```

Open [localhost:4173](http://127.0.0.1:4173). On later launches, only the final command is needed. No paid model calls are made until you start a comparison.

## Try it

- **Live flow:** compare your own message or run the selected message set.
- **Message sets:** all 540 Bitext samples, 270 practice samples, 270 test samples, or 12 authored demo examples.
- **Rounds:** repeat each message 1, 3, 5 or 10 times.
- **Arrival badges:** #1, #2 and #3 show successful reply arrival order. Completed nodes light up; after all replies the automatic test pauses for 3 seconds before the next message.
- **Stop:** finish the requests already started for the current message, then stop.
- **Results:** inspect four decisions, arrival placement totals, median/p95 latency, cost and available accuracy scores. Export your own report and reference-label audit.
- **System map:** inspect the architecture. Its animated trace is explanatory, not live API telemetry.

The default full run is **540 messages × 1 round × 3 settings = 1,620 measured requests**, plus three warm-ups. Three rounds make 4,860 measured requests. Calls use your provider accounts and may incur charges. For a quick first try, select the 12-message demo or compare one message manually.

## Dataset from Hugging Face

The sample library comes from [Bitext's customer-support dataset on Hugging Face](https://huggingface.co/datasets/bitext/Bitext-customer-support-llm-chatbot-training-dataset).

- Original dataset: **26,872 examples across 27 intents**.
- This repository includes **540 English messages**, sampled as 20 per intent with seed 42.
- Each intent contributes 10 practice and 10 test examples: **270 + 270**.
- This is **hybrid synthetic data**, not real Shopify customer conversations.
- These messages evaluate existing models; this application does not train them.

`data/source.json` records the source revision and checksum. `data/samples.json` contains messages, source-derived IDs, intent labels, categories and splits. Reproduce the sample with `python3 scripts/prepare-data.py` (network access required).

Bitext supplies **intent labels only** for this evaluation. Intent accuracy is therefore available immediately, without manual review. Urgency, missing-information and human-review decisions are displayed, but receive no accuracy score without a reference label. “All four correct” requires all four references.

## Optional human review

You do **not** need to label 540 messages before using the app.

The optional review panel lets you inspect and label the **12 authored demo examples** from a human perspective. Auto-fill provides editable, assistant-authored suggestions. Explicit user confirmation is required before these become reviewed references, and their origin remains in the export. They are not independent human annotations.

“Human review” as a model decision means **should this support request be escalated to a person?** It is separate from a person reviewing benchmark answers.

Reference answers are never sent to the models. Each run freezes its references; later edits do not change an existing report.

## What the measurements mean

- API latency covers the server-to-provider round trip and response processing, including OpenRouter overhead for Gemini. It excludes the presentation pause and database write.
- Arrival rank includes the browser/server/database path. It is not a pure inference-speed ranking or an accuracy ranking.
- Placement totals include groups where all three variants succeeded; warm-ups, incomplete groups and failed groups are excluded.
- Warm-ups are excluded from measured summaries and their cost is recorded separately.
- Failed responses count as incorrect where a reference exists. Missing cost data is unknown, not zero.
- Costs use the configured estimates or provider-reported usage. Check current pricing before drawing billing conclusions.
- Public synthetic data, repeated prompts, provider caches and network conditions limit generalization. Use the held-out test split and your own representative data for stronger conclusions.

No recorded model test results ship with the current project tree. Generate your own results; there is no claimed universal speed or accuracy winner. See [the detailed protocol](docs/EXPERIMENT.md).

## Project structure

| Path | Purpose |
| --- | --- |
| `components/decision-experiment.tsx` | Dataset selection, repeated runs, optional review and reports |
| `components/live-decision-flow.tsx` | Live diagram, decisions and arrival badges |
| `lib/experiment.ts` | Shared four-question policy and measurement calculations |
| `lib/server.ts` | Provider calls, validation, usage and database records |
| `lib/routing.ts` | Intents, departments and fictional owners |
| `app/api/experiment/route.ts` | One four-decision evaluation per request |
| `data/` | Reproducible sample, provenance and dataset license |
| `docs/system.architecture.json` | Editable architecture source |
| `public/system.html` | Standalone interactive system map |

Stack: React, TypeScript, Vinext/Vite and local Cloudflare D1 (SQLite). The system map uses [Archify](https://github.com/tt-a1i/archify); its license is retained in `docs/ARCHIFY-LICENSE`.

## Checks and local data

```bash
npx tsc --noEmit
node scripts/test-experiment.cjs
npm run build
# With the local server running; no paid provider requests:
node scripts/smoke.mjs
```

`node scripts/smoke.mjs --live` makes paid requests. The legacy single-intent comparison script, `scripts/compare.mjs`, also makes paid requests and saves its output under ignored `reports/`; use Live flow for the current four-decision protocol.

API keys, local D1 state, browser exports, reports and build artifacts must stay out of commits. Run history is stored locally in D1; labels and the current report are also stored in your browser. A fresh clone does not include another user's results.

This is a local, single-user demonstration. Publishing the repository does not deploy a hosted service. Add authentication, per-user storage and quotas before offering a shared hosted instance.

## License

Application code is MIT licensed; see [LICENSE](LICENSE). The Bitext sample retains its separate **CDLA-Sharing-1.0** license and attribution in [data/LICENSE.txt](data/LICENSE.txt) and [data/SOURCE.md](data/SOURCE.md). Third-party notices remain with their respective files.

## Contributions and security

See [CONTRIBUTING.md](CONTRIBUTING.md) and [SECURITY.md](SECURITY.md). This repository starts from a clean, single-commit snapshot. Historical test reports and API credentials are not included. Forks and PR suggestions are welcome; contributor changes require maintainer review.
