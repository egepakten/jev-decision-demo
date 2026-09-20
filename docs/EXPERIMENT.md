# Four-decision experiment

Open **Live flow** and use **Start test**. The primary experiment compares Jev, Gemini thinking off, and Gemini thinking on, using a single provider request to answer intent, urgency, missing information, and human-review requirement together. Results and export are under the expandable Results section; human review is available through Label examples.

## Dataset runs without manual labels

Live flow defaults to all 540 Bitext samples and one round (1,620 measured calls plus 3 warm-ups). Select 270 practice, 270 test, or 12 authored demo messages; repetitions can be 1, 3, 5 or 10. Each run snapshots its selected messages and reference labels for export. No labels are sent to providers. Dataset references have labelSource=dataset and only an intent label. Only intent accuracy is scored for these samples; the other three decisions and their timing/cost remain visible without fabricated accuracy. All-four accuracy requires all four reference labels. Human review is optional and available for the 12 authored cases. The full dataset is not automatically charged/run during setup.

## Human labels

The twelve messages are assistant-authored demonstration cases. They are neither independent real customer records nor human-labeled ground truth. Read the shared policy, enter your reviewer name, select each of the four labels, and explicitly confirm your review. Measured model answers are not shown in the annotation view. Optional Auto-fill suggested labels fills empty fields with assistant-authored rubric-based drafts. Existing selections are preserved. Suggestions require explicit review approval, individually or using the bulk confirmation button after entering a reviewer name. Approved suggestions retain labelSource=assistant_suggestions_reviewed in the audit; they are not independent human annotations. Edits revoke approval. These are reviewer attestations, not authenticated identities. A second independent reviewer and adjudication are recommended before publishing accuracy claims.

Only reviewed examples count toward accuracy. Unreviewed examples still measure latency and cost. A run freezes its label snapshot, so later edits cannot retroactively change its accuracy. Measured predictions are never used as suggested labels. Expected labels are never sent to either provider. To use new labels, start a new run. Browser storage retains labels and the most recent report on this device; **Export report and label audit** creates a portable JSON archive with messages, definitions, reviewer names/timestamps, label snapshot, per-request decisions, token usage, model IDs, and results. Avoid clearing browser storage before exporting.

## Protocol

- Default: 540 cases × 1 repetition × 3 variants = 1,620 measured calls, plus one warm-up per variant. A 3-round full run makes 4,860 measured calls.
- The three variants launch concurrently for each message; case order rotates each repetition. Each completed message is held for 3 seconds, outside API latency measurements. Stop finishes all already-started requests and skips the pause/next message. Arrival badges rank successful browser responses (including server/database/network time), not pure inference speed. Failed requests receive no rank. Thinking mode and reported thinking-token usage remain visible; no private reasoning text is requested. Old saved reports retain their original sequential measurements.
- Warm-ups are retained and billed but excluded from timing and accuracy summaries. Their costs are shown separately.
- Identical question definitions and options are shared from `lib/experiment.ts`. Jev receives four choice questions. Gemini receives a single structured JSON schema with four fields. Both see exactly the customer message, without labels.
- Gemini on: 1,024 thinking-token maximum, 2,048 total output maximum. Gemini off disables thinking. Both use temperature zero and the same pinned model.
- The entire output is validated. Invalid choices are failures. No silent retries or model fallback are added by the application; OpenRouter may route providers internally.
- Latency covers provider request through response parsing/validation, including OpenRouter overhead for Gemini. It excludes browser rendering and D1 persistence. This is an application-path comparison, not isolated model inference speed.
- Median uses the middle value (average for even counts). p95 uses nearest rank. Failed calls are excluded from timing and listed separately; they count as incorrect on reviewed examples.
- Accuracy is reported separately for every field and all-four exact match. Repeated observations are not independent examples; a small synthetic set cannot establish general model superiority. Review complete runs with balanced counts across variants.
- Costs use TypeSafe's input-token estimate or OpenRouter's reported cost. Unknown cost remains explicitly counted as unknown, not a free request. Thinking output usage is already included. Warm-up and measured costs are separate.
- Provider caching, shared serving load and route variation can affect repeated prompts; this is not a cache-disabled benchmark.

## Validation

`node scripts/test-experiment.cjs` checks median/p95, unreviewed accuracy, failure denominators, and missing costs. API smoke checks should confirm four validated choices for all three variants and nonzero reasoning usage when reported for thinking-on. Never label an assistant-authored test fixture as a human review.
