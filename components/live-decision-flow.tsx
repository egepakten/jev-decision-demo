"use client";
import { useEffect, useRef, useState } from "react";
import type { LiveExperimentStep } from "./decision-experiment";
import { Button } from "@/components/ui/button";
import { cases, fields, variants, type Variant } from "@/lib/experiment";
import { intents, teams, type ModelResult } from "@/lib/routing";
const names = {
  jev: "Jev",
  gemini_off: "Gemini 2.5 Flash-Lite",
  gemini_on: "Gemini 2.5 Flash-Lite",
};
const modes = {
  jev: "TypeSafe · direct",
  gemini_off: "Thinking off",
  gemini_on: "Thinking on · budget 1,024",
};
export default function LiveDecisionFlow({
  initialMessage,
  ready,
  onSaved,
  externalStep,
  externalActive = false,
  onBusy,
  embedded = false,
}: {
  initialMessage: string;
  ready: boolean;
  onSaved: () => void;
  externalStep?: LiveExperimentStep;
  externalActive?: boolean;
  onBusy?: (active: boolean) => void;
  embedded?: boolean;
}) {
  const [message, setMessage] = useState(initialMessage);
  const [results, setResults] = useState<Partial<Record<Variant, ModelResult>>>(
    {},
  );
  const [current, setCurrent] = useState<Variant | null>(null);
  const [busy, setBusy] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [done, setDone] = useState(0);
  const [error, setError] = useState("");
  const [sessionCost, setSessionCost] = useState(0);
  const [unknownCosts, setUnknownCosts] = useState(0);
  const lock = useRef(false),
    stop = useRef(false),
    mounted = useRef(true),
    cursor = useRef(0);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      stop.current = true;
    };
  }, []);
  useEffect(() => {
    if (!lock.current) {
      setMessage(initialMessage);
      setResults({});
    }
  }, [initialMessage]);
  const externalMessage = useRef("");
  useEffect(() => {
    if (!externalStep) return;
    const { message, variant, result } = externalStep;
    if (externalStep.reset || externalMessage.current !== message) {
      setResults({});
      externalMessage.current = message;
    }
    setMessage(message);
    setError("");
    setCurrent(result ? null : variant);
    if (externalStep.results) setResults(externalStep.results);
    if (result) {
      if (!externalStep.results)
        setResults((prev) => ({ ...prev, [variant]: result }));
      if (result.costUsd === undefined) setUnknownCosts((n) => n + 1);
      else setSessionCost((n) => n + result.costUsd!);
    }
  }, [externalStep]);
  useEffect(() => {
    if (!externalActive) setCurrent(null);
  }, [externalActive]);
  async function evaluateMessage(text: string, rotation: number) {
    setMessage(text);
    setResults({});
    setError("");
    setBusy(true);
    onBusy?.(true);
    let successful = true;
    try {
      const settled = await Promise.allSettled(
        variants.map(async (_, j) => {
          if (!mounted.current) return false;
          const variant = variants[(rotation + j) % variants.length];
          setCurrent(variant);
          const response = await fetch("/api/experiment", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ message: text, variant }),
          });
          const data = (await response.json()) as {
            result?: ModelResult;
            error?: string;
          };
          if (!response.ok || !data.result)
            throw Error(data.error || "Request failed.");
          const r = data.result;
          setResults((prev) => ({ ...prev, [variant]: r }));
          if (r.costUsd === undefined) setUnknownCosts((n) => n + 1);
          else setSessionCost((n) => n + r.costUsd!);
          if (r.error) successful = false;
        }),
      );
      const rejected = settled.find((r) => r.status === "rejected");
      if (rejected?.status === "rejected") throw rejected.reason;
      onSaved();
      return successful;
    } catch (e) {
      setError(
        e instanceof TypeError
          ? "Cannot reach the server. Restart the app and try again."
          : e instanceof Error
            ? e.message
            : "Request failed",
      );
      return false;
    } finally {
      setCurrent(null);
      setBusy(false);
      onBusy?.(false);
    }
  }
  async function manual() {
    if (lock.current) return;
    lock.current = true;
    try {
      await evaluateMessage(message, 0);
    } finally {
      lock.current = false;
    }
  }
  async function autoplay() {
    if (lock.current) return;
    lock.current = true;
    stop.current = false;
    setPlaying(true);
    if (cursor.current >= cases.length) {
      cursor.current = 0;
      setDone(0);
    }
    try {
      while (
        cursor.current < cases.length &&
        !stop.current &&
        mounted.current
      ) {
        const i = cursor.current;
        const ok = await evaluateMessage(cases[i].message, i);
        cursor.current++;
        setDone(cursor.current);
        if (!ok) {
          stop.current = true;
          setError(
            "Playback paused after a failed request. Review the model error before continuing.",
          );
        }
        const until = Date.now() + 1500;
        while (!stop.current && mounted.current && Date.now() < until)
          await new Promise((r) => setTimeout(r, 50));
      }
    } finally {
      lock.current = false;
      setPlaying(false);
    }
  }
  return (
    <section className="live-experiment">
      {!embedded && (
        <div className="live-demo-toolbar panel">
          <div>
            <strong>Benchmark in motion</strong>
            <small>Same 12 messages · same 4 questions · same 3 variants</small>
          </div>
          <div className="live-demo-progress">
            {cases.map((c, i) => (
              <i
                key={c.id}
                className={
                  i < done ? "done" : playing && i === done ? "current" : ""
                }
              />
            ))}
          </div>
          <span>
            {done} / {cases.length}
          </span>
          <Button
            disabled={!ready || (busy && !playing)}
            onClick={() => (playing ? (stop.current = true) : autoplay())}
          >
            {playing
              ? "Pause after this message"
              : done === cases.length
                ? "Replay 12 messages"
                : done
                  ? "Resume demo"
                  : "Start 12-message demo"}
          </Button>
          <Button
            variant="outline"
            disabled={playing || busy || !done}
            onClick={() => {
              cursor.current = 0;
              setDone(0);
            }}
          >
            Reset
          </Button>
        </div>
      )}
      {externalStep && !busy && (
        <p className="micro">{externalStep?.phase || "Starting test…"}</p>
      )}
      <div className="live-demo-workspace">
        <aside className="panel live-demo-composer">
          <h2>Incoming message</h2>
          <p className="micro">Test example or your own message</p>
          <select
            aria-label="Benchmark message"
            value={cases.findIndex((c) => c.message === message)}
            disabled={playing || busy || externalActive}
            onChange={(e) => {
              const i = Number(e.target.value);
              if (i < 0) return;
              setMessage(cases[i].message);
              setResults({});
            }}
          >
            <option value={-1}>Custom or dataset message</option>
            {cases.map((c, i) => (
              <option key={c.id} value={i}>
                Example {i + 1}: {c.message.slice(0, 40)}
              </option>
            ))}
          </select>
          <textarea
            aria-label="Customer message"
            maxLength={4000}
            value={message}
            disabled={playing || busy || externalActive}
            onChange={(e) => {
              setMessage(e.target.value);
              setResults({});
            }}
          />
          <Button
            disabled={
              !ready || playing || busy || externalActive || !message.trim()
            }
            onClick={manual}
          >
            {busy ? "Evaluating…" : "Compare all three variants"}
          </Button>
        </aside>
        <div className="panel live-demo-diagram">
          <div className="live-demo-source">
            Customer message{" "}
            <small>Identical definitions · no expected answers sent</small>
          </div>
          <div className="live-demo-connector">↓</div>
          <div className="live-demo-branches">
            {variants.map((v) => (
              <div
                key={v}
                className={
                  "live-demo-node " +
                  ((busy || externalActive) && !results[v]
                    ? "evaluating"
                    : results[v]?.error
                      ? "failed"
                      : results[v]
                        ? "complete"
                        : "")
                }
              >
                <strong>
                  {names[v]}{" "}
                  {results[v] && !results[v]?.error && (
                    <em className="arrival-rank">
                      #
                      {Object.keys(results)
                        .filter((key) => !results[key as Variant]?.error)
                        .indexOf(v) + 1}
                    </em>
                  )}
                </strong>
                <small>{modes[v]}</small>
                <span>
                  {(busy || externalActive) && !results[v]
                    ? "Evaluating four decisions…"
                    : results[v]?.error
                      ? "Request failed"
                      : results[v]
                        ? "Four decisions received · reply saved"
                        : "Waiting"}
                </span>
                <div className="diagram-owner">
                  {results[v] && !results[v]?.error ? (
                    (() => {
                      const owner = teams.find(
                        (t) => t.id === results[v]?.team,
                      );
                      return (
                        <>
                          <b style={{ color: owner?.color }}>
                            {owner
                              ? `Assigned to ${owner.person} · ${owner.name}`
                              : "→ Review queue"}
                          </b>
                          <small>
                            {results[v]?.decisions?.human_review === "required"
                              ? "Human review required"
                              : "Proposed assignment"}
                          </small>
                        </>
                      );
                    })()
                  ) : (
                    <small>
                      {results[v]?.error ? "No assignment" : "Awaiting owner"}
                    </small>
                  )}
                </div>
              </div>
            ))}
          </div>
          <div className="live-demo-connector">↓</div>
          <div className="live-demo-source">
            Intent · Urgency · Missing information · Human review
            <small>
              {busy
                ? "Responses appear as each request completes"
                : Object.keys(results).length === 3
                  ? "Results saved · routing shown below"
                  : "Ready to evaluate and save"}
            </small>
          </div>
        </div>
      </div>
      <div className="live-demo-results">
        {variants.map((v) => {
          const r = results[v];
          const team = teams.find((t) => t.id === r?.team);
          return (
            <article className="panel live-demo-card" key={v}>
              <header>
                <strong>
                  {names[v]}{" "}
                  {results[v] && !results[v]?.error && (
                    <em className="arrival-rank">
                      #
                      {Object.keys(results)
                        .filter((key) => !results[key as Variant]?.error)
                        .indexOf(v) + 1}
                    </em>
                  )}
                </strong>
                <span>
                  {v === "jev"
                    ? "Direct"
                    : v === "gemini_on"
                      ? "Thinking on"
                      : "Thinking off"}
                </span>
              </header>
              <p className="live-model-id">
                {r?.model ||
                  (v === "jev"
                    ? "Model ID pending"
                    : "google/gemini-2.5-flash-lite")}
              </p>
              {r?.error ? (
                <p className="error">{r.error}</p>
              ) : (
                <div className="live-decision-list">
                  {fields.map((f) => (
                    <div key={f}>
                      <span>{f.replaceAll("_", " ")}</span>
                      <b>
                        {r?.decisions?.[f]
                          ? f === "intent"
                            ? intents[r.decisions[f]]?.label
                            : r.decisions[f].replaceAll("_", " ")
                          : "—"}
                      </b>
                    </div>
                  ))}
                </div>
              )}
              <div className="live-owner">
                {r && !r.error
                  ? team
                    ? `Assigned to ${team.person} · ${team.name}`
                    : "Review queue"
                  : "Awaiting routing"}
                {r?.decisions?.human_review === "required"
                  ? " · human review required"
                  : ""}
              </div>
              <div className="live-costs">
                <span>
                  API time{" "}
                  <b>{r && !r.error ? `${Math.round(r.latencyMs)} ms` : "—"}</b>
                </span>
                <span>
                  Request cost{" "}
                  <b>
                    {r?.costUsd !== undefined
                      ? `$${r.costUsd.toFixed(6)}`
                      : "—"}
                  </b>
                </span>
                <span>
                  Input / thinking{" "}
                  <b>
                    {r
                      ? `${r.inputTokens ?? "—"} / ${r.reasoningTokens ?? (v === "jev" ? "n/a" : "—")}`
                      : "—"}
                  </b>
                </span>
              </div>
            </article>
          );
        })}
      </div>
      <div className="live-demo-footnote">
        <span role={error ? "alert" : undefined}>
          {error ||
            (!ready
              ? "Connect both providers to compare all variants."
              : "Live demonstration · no accuracy claim for unreviewed messages")}
        </span>
        <span>
          Current message · known cost: $
          {Object.values(results)
            .reduce((sum, r) => sum + (r?.costUsd ?? 0), 0)
            .toFixed(6)}
          {Object.values(results).some((r) => r?.costUsd === undefined)
            ? " · some costs unknown"
            : ""}
        </span>
      </div>
      {!embedded && (
        <p className="micro live-demo-method">
          Playback pauses are for the video only and excluded from API time.
          Benchmark adds warm-ups, repetitions, median/p95 and human-reviewed
          accuracy. Routing suggestions do not execute store actions.
        </p>
      )}
    </section>
  );
}
