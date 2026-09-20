import { cases, fields, type Decisions } from "./experiment";
// Assistant-authored starting points for this fixed demo set, not ground truth.
// Deliberately independent of the models' measured predictions.
const values: Decisions[] = [
  {
    intent: "track_order",
    urgency: "normal",
    missing_information: "sufficient",
    human_review: "not_required",
  },
  {
    intent: "track_order",
    urgency: "normal",
    missing_information: "sufficient",
    human_review: "required",
  },
  {
    intent: "cancel_order",
    urgency: "urgent",
    missing_information: "sufficient",
    human_review: "not_required",
  },
  {
    intent: "check_payment_methods",
    urgency: "normal",
    missing_information: "sufficient",
    human_review: "not_required",
  },
  {
    intent: "get_refund",
    urgency: "normal",
    missing_information: "missing",
    human_review: "not_required",
  },
  {
    intent: "track_refund",
    urgency: "normal",
    missing_information: "sufficient",
    human_review: "not_required",
  },
  {
    intent: "complaint",
    urgency: "urgent",
    missing_information: "sufficient",
    human_review: "required",
  },
  {
    intent: "contact_human_agent",
    urgency: "normal",
    missing_information: "sufficient",
    human_review: "required",
  },
  {
    intent: "change_shipping_address",
    urgency: "normal",
    missing_information: "sufficient",
    human_review: "not_required",
  },
  {
    intent: "change_shipping_address",
    urgency: "normal",
    missing_information: "missing",
    human_review: "not_required",
  },
  {
    intent: "unknown",
    urgency: "urgent",
    missing_information: "missing",
    human_review: "required",
  },
  {
    intent: "unknown",
    urgency: "unclear",
    missing_information: "unclear",
    human_review: "unclear",
  },
];
export const suggestions = Object.fromEntries(
  cases.map((c, i) => [c.id, { message: c.message, labels: values[i] }]),
);
export function fillMissingLabels(draft: Record<string, Partial<Decisions>>) {
  const next = structuredClone(draft);
  const changed: string[] = [];
  for (const c of cases) {
    const s = suggestions[c.id];
    if (!s || s.message !== c.message) continue;
    for (const f of fields) {
      if (!next[c.id]?.[f]) {
        next[c.id] = { ...next[c.id], [f]: s.labels[f] };
        if (!changed.includes(c.id)) changed.push(c.id);
      }
    }
  }
  return { draft: next, changed };
}
