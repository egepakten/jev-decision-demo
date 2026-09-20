"use client";
import { useEffect, useRef, useState } from "react";
import samples from "@/data/samples.json";
import type { ModelResult } from "@/lib/routing";
import { fillMissingLabels } from "@/lib/label-suggestions";
import { Button } from "@/components/ui/button";
import {
  cases,
  fields,
  questions,
  variants,
  variantNames,
  rubricVersion,
  summarize,
  arrivalCounts,
  type Annotation,
  type Decisions,
  type Observation,
} from "@/lib/experiment";
type Report = {
  rubricVersion: string;
  startedAt: string;
  repetitions: number;
  gold: Record<string, Annotation>;
  rows: Observation[];
  warmups: Observation[];
  status: string;
  protocol?: string;
  cases?: { id: string; message: string }[];
};
const storage = "route-lab-four-decisions-v1";
export type LiveExperimentStep = {
  message: string;
  variant: (typeof variants)[number];
  result?: ModelResult;
  phase: string;
  reset?: boolean;
  results?: Partial<Record<(typeof variants)[number], ModelResult>>;
};
export default function DecisionExperiment({
  flow,
  onStep,
  onActive,
  disabled = false,
}: {
  flow?: React.ReactNode;
  onStep?: (step: LiveExperimentStep) => void;
  onActive?: (active: boolean) => void;
  disabled?: boolean;
}) {
  const [gold, setGold] = useState<Record<string, Annotation>>({});
  const [draft, setDraft] = useState<Record<string, Partial<Decisions>>>({});
  const [suggestedIds, setSuggestedIds] = useState<string[]>([]);
  const [reviewer, setReviewer] = useState("");
  const [report, setReport] = useState<Report | null>(null);
  const [active, setActive] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [repetitions, setRepetitions] = useState(1);
  const [source, setSource] = useState("bitext");
  const runCases =
    source === "demo"
      ? cases
      : samples
          .filter((s) => source === "bitext" || s.split === source)
          .map((s) => ({ id: s.id, message: s.text }));
  const reportCases = report?.cases ?? cases;
  const [labeling, setLabeling] = useState(false);
  const [error, setError] = useState("");
  const stop = useRef(false);
  const lock = useRef(false);
  useEffect(() => {
    try {
      const data = JSON.parse(localStorage.getItem(storage) || "null");
      if (data) {
        setGold(data.gold || {});
        setDraft(data.draft || {});
        setReviewer(data.reviewer || "");
        setSuggestedIds(data.suggestedIds || []);
        if (data.report)
          setReport({
            ...data.report,
            status:
              data.report.status === "running"
                ? "interrupted"
                : data.report.status,
          });
      }
    } catch {}
    return () => {
      stop.current = true;
    };
  }, []);
  function persist(
    g = gold,
    d = draft,
    r = report,
    name = reviewer,
    sources = suggestedIds,
  ) {
    try {
      localStorage.setItem(
        storage,
        JSON.stringify({
          gold: g,
          draft: d,
          report: r,
          reviewer: name,
          suggestedIds: sources,
        }),
      );
    } catch {
      setError(
        "Browser storage is unavailable. Export your results before leaving.",
      );
    }
  }
  function approve(id: string, message: string) {
    const labels = draft[id];
    if (!labels || !reviewer.trim() || fields.some((f) => !labels[f])) return;
    const next = {
      ...gold,
      [id]: {
        labels: labels as Decisions,
        labelSource: suggestedIds.includes(id)
          ? ("assistant_suggestions_reviewed" as const)
          : ("manual" as const),
        message,
        reviewer: reviewer.trim(),
        reviewedAt: new Date().toISOString(),
        rubricVersion,
      },
    };
    setGold(next);
    persist(next);
  }
  function autoFill() {
    const filled = fillMissingLabels(draft);
    const sources = [...new Set([...suggestedIds, ...filled.changed])];
    setDraft(filled.draft);
    setSuggestedIds(sources);
    persist(gold, filled.draft, report, reviewer, sources);
  }
  function approveAll() {
    if (
      !reviewer.trim() ||
      cases.some((c) => fields.some((f) => !draft[c.id]?.[f]))
    )
      return;
    const reviewedAt = new Date().toISOString();
    const next: Record<string, Annotation> = { ...gold };
    for (const c of cases)
      next[c.id] = {
        labels: { ...draft[c.id] } as Decisions,
        message: c.message,
        reviewer: reviewer.trim(),
        reviewedAt,
        rubricVersion,
        labelSource: suggestedIds.includes(c.id)
          ? "assistant_suggestions_reviewed"
          : "manual",
      };
    setGold(next);
    persist(next);
  }
  async function run() {
    if (lock.current || disabled) return;
    lock.current = true;
    stop.current = false;
    setActive(true);
    setStopping(false);
    onActive?.(true);
    setLabeling(false);
    setError("");
    const snapshot: Record<string, Annotation> = {};
    for (const c of runCases) {
      const reviewed = gold[c.id];
      if (
        reviewed?.message === c.message &&
        reviewed.rubricVersion === rubricVersion
      )
        snapshot[c.id] = reviewed;
      else {
        const sample = samples.find((s) => s.id === c.id);
        if (sample)
          snapshot[c.id] = {
            labels: { intent: sample.intent },
            labelSource: "dataset",
            message: c.message,
            reviewer: "Bitext dataset",
            reviewedAt: "",
            rubricVersion,
          };
      }
    }
    let next: Report = {
      rubricVersion,
      cases: runCases.map((c) => ({ ...c })),
      startedAt: new Date().toISOString(),
      repetitions,
      gold: structuredClone(snapshot),
      rows: [],
      warmups: [],
      status: "running",
      protocol:
        "Concurrent variants per message; 3-second display pause excluded from API latency.",
    };
    const publish = () => {
      setReport({ ...next, rows: [...next.rows], warmups: [...next.warmups] });
      persist(gold, draft, next);
    };
    publish();
    let lastStep: LiveExperimentStep | undefined;
    let currentResults: Partial<
      Record<(typeof variants)[number], ModelResult>
    > = {};
    const emitStep = (step: LiveExperimentStep) => {
      if (step.reset || lastStep?.message !== step.message) currentResults = {};
      if (step.result)
        currentResults = { ...currentResults, [step.variant]: step.result };
      lastStep = { ...step, results: { ...currentResults } };
      onStep?.(lastStep);
    };
    try {
      // Warm each variant once; retain those costs separately from measured requests.
      for (const variant of variants) {
        if (stop.current) break;
        emitStep({
          message: runCases[0].message,
          variant,
          phase: "Warm-up · excluded from measurements",
          reset: variant === variants[0],
        });
        const res = await fetch("/api/experiment", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ variant, message: runCases[0].message }),
        });
        const data = (await res.json()) as {
          result: ModelResult;
          error?: string;
        };
        if (!res.ok || data.result?.error)
          throw Error(data.error || data.result?.error || "Warm-up failed");
        emitStep({
          message: runCases[0].message,
          variant,
          result: data.result,
          phase: "Warm-up · saved",
        });
        next.warmups.push({
          caseId: runCases[0].id,
          repetition: -1,
          variant,
          result: data.result,
          recordedAt: new Date().toISOString(),
        });
        publish();
      }
      for (
        let repetition = 0;
        repetition < repetitions && !stop.current;
        repetition++
      ) {
        for (let i = 0; i < runCases.length && !stop.current; i++) {
          const c = runCases[(i + repetition) % runCases.length];
          const order = variants.map(
            (_, j) => variants[(j + i + repetition) % variants.length],
          );
          emitStep({
            message: c.message,
            variant: order[0],
            reset: true,
            phase: `Round ${repetition + 1}/${repetitions} · message ${i + 1}/${runCases.length} · Concurrent requests`,
          });
          const settled = await Promise.allSettled(
            order.map(async (variant) => {
              const res = await fetch("/api/experiment", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ variant, message: c.message }),
              });
              const data = (await res.json()) as {
                result: ModelResult;
                error?: string;
              };
              if (!res.ok || !data.result)
                throw Error(data.error || "Request failed");
              emitStep({
                message: c.message,
                variant,
                result: data.result,
                phase: `Round ${repetition + 1}/${repetitions} · saved`,
              });
              next.rows.push({
                caseId: c.id,
                repetition,
                variant,
                result: data.result,
                recordedAt: new Date().toISOString(),
              });
              publish();
            }),
          );
          const rejected = settled.find((r) => r.status === "rejected");
          if (rejected?.status === "rejected") throw rejected.reason;
          // Presentation pause is outside provider latency and can be stopped immediately.
          const until = Date.now() + 3000;
          while (!stop.current && Date.now() < until)
            await new Promise((resolve) => setTimeout(resolve, 100));
        }
      }
      next.status = stop.current ? "stopped" : "completed";
    } catch (e) {
      next.status = "interrupted";
      setError(e instanceof Error ? e.message : "Connection failed");
    } finally {
      if (lastStep)
        onStep?.({
          ...lastStep,
          reset: false,
          results: { ...currentResults },
          phase: `${next.status} · ${lastStep.phase} · Latest message only`,
        });
      publish();
      setStopping(false);
      lock.current = false;
      setActive(false);
      onActive?.(false);
    }
  }
  const arrivals = report?.protocol?.startsWith("Concurrent")
    ? arrivalCounts(report.rows)
    : null;
  const summaries = report ? summarize(report.rows, report.gold) : [];
  const pct = (n: unknown) =>
    typeof n === "number" ? `${(100 * n).toFixed(1)}%` : "Not scored";
  return (
    <section
      className={
        flow ? "experiment-panel unified-experiment" : "panel experiment-panel"
      }
    >
      {!flow && (
        <>
          <p className="eyebrow">FOUR DECISIONS · ONE REQUEST PER VARIANT</p>
          <h2>Compare decisions, not just labels.</h2>
          <p>
            Intent, urgency, missing information and human review. Jev and both
            Gemini settings receive identical definitions and the same message,
            without expected answers.
          </p>
        </>
      )}
      <details className="experiment-policy">
        <summary>Read the shared evaluation policy</summary>
        {fields.map((f) => (
          <div key={f}>
            <h3>{f.replaceAll("_", " ")}</h3>
            <p>{questions[f].instructions}</p>
            {Object.entries(questions[f].criteria).map(([k, v]) => (
              <p key={k}>
                <b>{k}:</b> {String(v)}
              </p>
            ))}
          </div>
        ))}
      </details>
      <div className="experiment-controls">
        <Button
          variant="outline"
          disabled={active || disabled}
          onClick={() => setLabeling(!labeling)}
        >
          {labeling ? "Show experiment" : "Optional review · 12 demo examples"}
        </Button>
        <label>
          Messages{" "}
          <select
            aria-label="Test messages"
            disabled={active || disabled}
            value={source}
            onChange={(e) => setSource(e.target.value)}
          >
            <option value="bitext">All 540 Bitext samples</option>
            <option value="dev">270 practice samples</option>
            <option value="test">270 test samples</option>
            <option value="demo">12 demo examples</option>
          </select>
        </label>
        <label>
          Rounds{" "}
          <select
            disabled={active || disabled}
            value={repetitions}
            onChange={(e) => setRepetitions(Number(e.target.value))}
          >
            {[1, 3, 5, 10].map((n) => (
              <option key={n}>{n}</option>
            ))}
          </select>
        </label>
        <Button disabled={active || disabled} onClick={run}>
          Start test · {runCases.length * repetitions * 3} calls
        </Button>
        {active && (
          <Button
            variant="outline"
            onClick={() => {
              stop.current = true;
              setStopping(true);
            }}
          >
            {stopping
              ? "Stopping · finishing active requests…"
              : "Stop after current message"}
          </Button>
        )}
        <div className="run-counter" role="status" aria-live="polite">
          <strong>
            {report?.rows.length ?? 0}
            <span>
              /
              {(report ? reportCases.length : runCases.length) *
                (report?.repetitions ?? repetitions) *
                variants.length}
            </span>
          </strong>
          <small>
            {stopping
              ? "Finishing active requests"
              : active && !report?.rows.length
                ? "Warming up"
                : (report?.status ?? "Ready")}{" "}
            · measured calls
          </small>
        </div>
      </div>
      <p className="micro experiment-formula">
        {runCases.length} messages × {repetitions} rounds × 3 model settings ={" "}
        {runCases.length * repetitions * 3} measured calls. Plus 3 warm-up calls
        (one per setting), excluded from results. Total:{" "}
        {runCases.length * repetitions * 3 + 3} API calls. Three variants run
        together; each message stays visible for 3 seconds after all replies.
        Arrival rank includes network and database time.
      </p>
      <p className="micro">
        No labeling required. Bitext intent accuracy uses supplied dataset
        labels. Urgency, missing information and human-review decisions are
        displayed without accuracy scores unless separately reviewed. Optional
        review applies to the 12 demo examples.
      </p>
      {!labeling && flow}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {labeling ? (
        <div className="annotation-panel">
          <h3>Human review before evaluation</h3>
          <p>
            Fill empty fields with prepared AI suggestions, check or edit them
            against the policy, then confirm your review. These are starting
            points, not verified answers or measured model predictions.
            Unreviewed examples contribute timing and cost only. Later label
            edits do not change an existing report.
          </p>
          <div className="experiment-controls">
            <Button
              variant="outline"
              disabled={active || disabled}
              onClick={autoFill}
            >
              Auto-fill suggested labels
            </Button>
            <Button
              disabled={
                active ||
                disabled ||
                !reviewer.trim() ||
                cases.some((c) => fields.some((f) => !draft[c.id]?.[f]))
              }
              onClick={approveAll}
            >
              I reviewed all 12 examples — confirm labels
            </Button>
          </div>
          <p className="micro">
            Auto-fill preserves your existing selections and adds no API cost.
            Suggestions are not scored until you explicitly confirm your review.
            Approval records their AI-assisted origin.
          </p>
          <label>
            Reviewer name{" "}
            <input
              value={reviewer}
              disabled={active || disabled}
              onChange={(e) => {
                setReviewer(e.target.value);
                persist(gold, draft, report, e.target.value);
              }}
              placeholder="Your name"
            />
          </label>
          {cases.map((c) => (
            <article key={c.id} className="annotation-row">
              <p>
                <b>{c.id}</b> · {c.message}
                {suggestedIds.includes(c.id) && !gold[c.id] && (
                  <small className="micro">
                    {" "}
                    · AI suggestion — needs review
                  </small>
                )}
              </p>
              <div className="annotation-fields">
                {fields.map((f) => (
                  <label key={f}>
                    {f.replaceAll("_", " ")}
                    <select
                      value={draft[c.id]?.[f] || ""}
                      onChange={(e) => {
                        const d = {
                          ...draft,
                          [c.id]: { ...draft[c.id], [f]: e.target.value },
                        };
                        const g = { ...gold };
                        delete g[c.id];
                        setDraft(d);
                        setGold(g);
                        persist(g, d);
                      }}
                    >
                      <option value="">Choose…</option>
                      {Object.keys(questions[f].criteria).map((k) => (
                        <option key={k} value={k}>
                          {k.replaceAll("_", " ")}
                        </option>
                      ))}
                    </select>
                  </label>
                ))}
              </div>
              <Button
                variant="outline"
                disabled={
                  !reviewer.trim() || fields.some((f) => !draft[c.id]?.[f])
                }
                onClick={() => approve(c.id, c.message)}
              >
                I reviewed these four labels
              </Button>
              {gold[c.id] && (
                <span className="micro">
                  {" "}
                  Reviewed by {gold[c.id].reviewer}
                </span>
              )}
            </article>
          ))}
        </div>
      ) : report ? (
        <details className="experiment-report" open={!flow || undefined}>
          <summary>
            All completed calls · {report.status} · {report.rows.length}/
            {reportCases.length * report.repetitions * 3} measured calls —
            median, p95, cost and accuracy
          </summary>
          <p className="micro">
            Cumulative results from this run, including the final request
            completed before stopping.
          </p>
          <p aria-live="polite">
            {report.status} · {report.rows.length}/
            {reportCases.length * report.repetitions * 3} measured requests ·{" "}
            {report.warmups.length}/3 warm-ups ·{" "}
            {Object.keys(report.gold).length} messages with reference labels in
            this frozen snapshot
          </p>
          <div className="experiment-results">
            {summaries.map((s) => (
              <article className="result-card" key={s.variant}>
                <header className="experiment-model-heading">
                  <h3>
                    {s.variant === "jev" ? "Jev" : "Gemini 2.5 Flash-Lite"}
                  </h3>
                  <p className="experiment-model-id">
                    {[
                      ...new Set(
                        [...report.rows, ...report.warmups]
                          .filter((r) => r.variant === s.variant)
                          .map((r) => r.result.model),
                      ),
                    ].join(" · ") || "Model ID pending"}
                  </p>
                  <span className="experiment-mode-badge">
                    {s.variant === "jev"
                      ? "TypeSafe · direct"
                      : s.variant === "gemini_on"
                        ? "Thinking on · 1,024-token budget"
                        : "Thinking off"}
                  </span>
                </header>
                {arrivals ? (
                  <div
                    className="arrival-totals"
                    aria-label="Arrival rank totals"
                  >
                    {arrivals.counts[s.variant].map((count, index) => (
                      <span key={index}>
                        #{index + 1}
                        <b>
                          {count}
                          <small> times</small>
                        </b>
                      </span>
                    ))}
                    <small>
                      {arrivals.races} completed races · arrival order
                    </small>
                  </div>
                ) : (
                  <p className="micro">
                    Arrival ranks unavailable for this older sequential run.
                  </p>
                )}
                <div className="experiment-stats">
                  <span>
                    Median{" "}
                    <b>
                      {s.median === null ? "—" : `${Math.round(s.median)} ms`}
                    </b>
                  </span>
                  <span>
                    p95{" "}
                    <b>{s.p95 === null ? "—" : `${Math.round(s.p95)} ms`}</b>
                  </span>
                  <span>
                    Successful calls{" "}
                    <b>
                      {s.success}/{s.total}
                    </b>
                  </span>
                  <span>
                    Known measured cost <b>${s.knownCost.toFixed(6)}</b>
                  </span>
                </div>
                <p className="micro">
                  {s.failures} failed · {s.unknownCost} unknown costs ·{" "}
                  {s.scored} labeled observations
                </p>
                {fields.map((f) => (
                  <p className="accuracy-line" key={f}>
                    <span>{f.replaceAll("_", " ")}</span>
                    <b>{pct(s.accuracy[f])}</b>
                  </p>
                ))}
                <p className="accuracy-line">
                  <span>All four correct</span>
                  <b>{pct(s.exact)}</b>
                </p>
              </article>
            ))}
          </div>
          <p className="micro">
            Arrival totals include only messages where all three variants
            succeeded; warm-ups and incomplete groups are excluded. These ranks
            measure arrival order, not correctness. Accuracy counts failures as
            incorrect on reviewed messages; repeated observations are not
            independent examples. Timing uses successful calls only. p95 uses
            nearest rank and is unstable with small samples. Warm-up cost: $
            {report.warmups
              .reduce((s, x) => s + (x.result.costUsd ?? 0), 0)
              .toFixed(6)}{" "}
            (excluded above).
          </p>
          <Button
            variant="outline"
            onClick={() => {
              const blob = new Blob(
                [
                  JSON.stringify(
                    {
                      ...report,
                      questions,
                      cases: reportCases,
                      summary: summaries,
                      arrivalTotals: arrivals,
                      method:
                        (report.protocol ??
                          "Legacy sequential calls with rotating variant order.") +
                        " One warm-up per variant. No expected labels sent. User-attested labels; costs include thinking. Unknown costs are not zero. Synthetic demo, not a general model ranking.",
                    },
                    null,
                    2,
                  ),
                ],
                { type: "application/json" },
              );
              const url = URL.createObjectURL(blob);
              const a = document.createElement("a");
              a.href = url;
              a.download = "four-decision-experiment.json";
              a.click();
              URL.revokeObjectURL(url);
            }}
          >
            Export report and label audit
          </Button>
          <details>
            <summary>Inspect all four model decisions</summary>
            {report.rows.map((r, i) => (
              <p key={i}>
                Example {reportCases.findIndex((c) => c.id === r.caseId) + 1} ·
                round {r.repetition + 1} · {variantNames[r.variant]} ·{" "}
                {r.result.error ||
                  fields
                    .map((f) => `${f}: ${r.result.decisions?.[f]}`)
                    .join(" / ")}
              </p>
            ))}
          </details>
        </details>
      ) : (
        <p>
          Start directly: dataset intent labels are ready. Other decisions need
          no labels to run; their accuracy is not scored without reference
          answers.
        </p>
      )}
    </section>
  );
}
