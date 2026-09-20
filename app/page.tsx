"use client";
import { useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  ArrowUpRight,
  Boxes,
  Database,
  GitBranch,
  Play,
  Sparkles,
  Check,
  LoaderCircle,
  Inbox,
  Workflow,
  FlaskConical,
  CircleAlert,
  Pause,
  RotateCcw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  teams,
  intents,
  type Sample,
  type ModelResult,
  type SavedRun,
} from "@/lib/routing";

import LiveDecisionFlow from "@/components/live-decision-flow";
import DecisionExperiment, {
  type LiveExperimentStep,
} from "@/components/decision-experiment";
import { demoMessages } from "@/lib/demo-messages";

export default function Home() {
  const [experimentStep, setExperimentStep] = useState<LiveExperimentStep>();
  const [experimentRunning, setExperimentRunning] = useState(false);
  const [liveBusy, setLiveBusy] = useState(false);
  const [samples, setSamples] = useState<Sample[]>([]);
  const [selected, setSelected] = useState("");
  const [message, setMessage] = useState(
    "My parcel says delivered, but I haven't received it.",
  );
  const [compare, setCompare] = useState(false);
  const [config, setConfig] = useState({
    jev: false,
    gemini: false,
    jevModel: "Jev",
    geminiModel: "Gemini",
  });
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState("idle");
  const [events, setEvents] = useState<string[]>([]);
  const [results, setResults] = useState<ModelResult[]>([]);
  const [history, setHistory] = useState<SavedRun[]>([]);
  const [error, setError] = useState("");
  const [tab, setTab] = useState("flow");
  const [batch, setBatch] = useState<{
    done: number;
    total: number;
    results: ModelResult[];
    error?: string;
  } | null>(null);
  const stop = useRef(false);
  const requestLock = useRef(false);
  const autoLoop = useRef(false);
  const autoStop = useRef(false);
  const autoCursor = useRef(0);
  const mounted = useRef(true);
  const [autoState, setAutoState] = useState<
    "idle" | "running" | "pausing" | "paused" | "completed"
  >("idle");
  const [autoDone, setAutoDone] = useState(0);
  const [sessionResults, setSessionResults] = useState<ModelResult[]>([]);
  const autoActive = autoState === "running" || autoState === "pausing";
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      autoStop.current = true;
      stop.current = true;
    };
  }, []);

  useEffect(() => {
    Promise.all([
      fetch("/api/samples").then(
        (r) => r.json() as Promise<{ samples: Sample[] }>,
      ),
      fetch("/api/config").then(
        (r) =>
          r.json() as Promise<{
            jev: boolean;
            gemini: boolean;
            jevModel: string;
            geminiModel: string;
          }>,
      ),
      fetch("/api/history").then(
        (r) => r.json() as Promise<{ runs: SavedRun[]; error?: string }>,
      ),
    ])
      .then(([s, c, h]) => {
        setSamples(s.samples || []);
        setConfig(c);
        setHistory(h.runs || []);
        if (h.error) setError(h.error);
      })
      .catch(() => setError("Could not connect to the server."));
  }, []);
  useEffect(() => {
    const context = (
      document as unknown as {
        modelContext?: {
          registerTool: (
            tool: unknown,
            options: { signal: AbortSignal },
          ) => void | Promise<void>;
        };
      }
    ).modelContext;
    if (!context?.registerTool) return;
    const lifecycle = new AbortController();
    try {
      void Promise.resolve(
        context.registerTool(
          {
            name: "stage_support_message",
            title: "Stage support message",
            description:
              "Put a customer message in the composer. Does not call a model or create an assignment.",
            inputSchema: {
              type: "object",
              properties: {
                message: { type: "string", minLength: 1, maxLength: 4000 },
              },
              required: ["message"],
              additionalProperties: false,
            },
            annotations: { readOnlyHint: false, untrustedContentHint: true },
            execute(input: unknown) {
              const value = input as { message?: unknown };
              if (requestLock.current || autoLoop.current || batchActive)
                throw new Error("A request is in progress");
              if (
                typeof value?.message !== "string" ||
                !value.message.trim() ||
                value.message.length > 4000
              )
                throw new Error("Invalid message");
              setMessage(value.message);
              setSelected("");
              setResults([]);
              setStage("idle");
              setTab("flow");
              return { staged: true, submitted: false };
            },
          },
          { signal: lifecycle.signal },
        ),
      ).catch(() => {});
    } catch {}
    return () => lifecycle.abort();
  }, [busy, samples]);
  const sample = samples.find((s) => s.id === selected && s.text === message);
  const primary = results.find((r) => r.provider === "jev" && !r.error);
  const destination = teams.find((t) => t.id === primary?.team);
  function choose(s: Sample) {
    setSelected(s.id);
    setMessage(s.text);
    setResults([]);
    setStage("idle");
    setEvents([]);
    setError("");
  }
  async function run(text = message, sampleId?: string) {
    if (requestLock.current)
      return { results: [] as ModelResult[], saved: false };
    requestLock.current = true;
    let saved = false;
    setBusy(true);
    setError("");
    setResults([]);
    setEvents([]);
    setStage("received");
    let returned: ModelResult[] = [];
    try {
      const response = await fetch("/api/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text, sampleId, compare }),
      });
      if (!response.ok) {
        const e = (await response.json()) as { error?: string };
        throw new Error(e.error || "Request failed.");
      }
      const reader = response.body!.getReader();
      const decoder = new TextDecoder();
      let pending = "";
      while (true) {
        const { value, done } = await reader.read();
        pending += decoder.decode(value, { stream: !done });
        const lines = pending.split("\n");
        pending = lines.pop() || "";
        for (const line of lines.filter(Boolean)) {
          const e = JSON.parse(line);
          if (e.stage) setStage(e.stage);
          if (e.label) setEvents((prev) => [...prev, e.label]);
          if (e.results) {
            setResults(e.results);
            returned = e.results;
          }
          if (e.run) {
            setHistory((prev) => [e.run, ...prev].slice(0, 100));
            saved = e.stage === "saved";
          }
          if (e.error) {
            setError(e.error);
            setStage("error");
          }
        }
        if (done) break;
      }
    } catch (e) {
      const detail =
        e instanceof TypeError
          ? "Cannot reach the local server. Restart the app, refresh this page, and try again."
          : e instanceof Error
            ? e.message
            : "Connection interrupted.";
      setError(detail);
      setStage("error");
      returned = (["jev", ...(compare ? ["gemini"] : [])] as const).map(
        (provider) => ({
          provider: provider as "jev" | "gemini",
          model: provider === "jev" ? config.jevModel : config.geminiModel,
          latencyMs: 0,
          error: detail,
          correct: sampleId ? false : undefined,
          teamCorrect: sampleId ? false : undefined,
        }),
      );
      setResults(returned);
    } finally {
      requestLock.current = false;
      setBusy(false);
    }
    setSessionResults((prev) => [...prev, ...returned]);
    return { results: returned, saved };
  }
  async function benchmark() {
    if (requestLock.current || autoLoop.current) return;
    const pool = samples.filter((s) => s.split === "test");
    const picks: Sample[] = [];
    for (const key of Object.keys(intents)) {
      const s = pool.find((s) => s.intent === key);
      if (s) picks.push(s);
    }
    stop.current = false;
    let all: ModelResult[] = [];
    setBatch({ done: 0, total: picks.length, results: [] });
    for (let i = 0; i < picks.length; i++) {
      if (stop.current) break;
      const s = picks[i];
      setSelected(s.id);
      setMessage(s.text);
      const out = await run(s.text, s.id);
      all = [...all, ...out.results];
      if (!out.saved) {
        stop.current = true;
        setBatch({
          done: i + 1,
          total: picks.length,
          results: all,
          error:
            out.results.find((r) => r.error)?.error ||
            "The response was interrupted or could not be saved. Check the server and retry.",
        });
        break;
      }
      setBatch({ done: i + 1, total: picks.length, results: all });
    }
  }
  async function presentationWait(ms: number) {
    const until = Date.now() + ms;
    while (Date.now() < until && !autoStop.current && mounted.current) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
  async function startAuto() {
    if (autoLoop.current || requestLock.current || batchActive) return;
    if (autoCursor.current >= demoMessages.length) {
      autoCursor.current = 0;
      setAutoDone(0);
    }
    autoLoop.current = true;
    autoStop.current = false;
    setAutoState("running");
    setTab("flow");
    try {
      while (
        autoCursor.current < demoMessages.length &&
        !autoStop.current &&
        mounted.current
      ) {
        const text = demoMessages[autoCursor.current];
        setSelected("");
        setMessage(text);
        setResults([]);
        setStage("idle");
        setEvents([]);
        setError("");
        await presentationWait(650);
        if (autoStop.current || !mounted.current) break;
        const outcome = await run(text);
        autoCursor.current += 1;
        setAutoDone(autoCursor.current);
        if (!outcome.saved || outcome.results.some((r) => r.error)) {
          autoStop.current = true;
          break;
        }
        await presentationWait(1900);
      }
    } finally {
      autoLoop.current = false;
      if (mounted.current)
        setAutoState(
          autoCursor.current >= demoMessages.length ? "completed" : "paused",
        );
    }
  }
  function pauseAuto() {
    autoStop.current = true;
    setAutoState("pausing");
  }
  function resetAuto() {
    if (autoLoop.current || requestLock.current) return;
    autoCursor.current = 0;
    setAutoDone(0);
    setAutoState("idle");
  }
  const batchActive =
    batch !== null && batch.done < batch.total && !stop.current;
  return (
    <main>
      <section className="heading">
        <div>
          <p className="eyebrow">ONE MESSAGE. THE RIGHT PERSON.</p>
          <h1>Follow the decision.</h1>
          <p>Watch customer messages become assigned work.</p>
        </div>
        <div className="heading-actions">
          <span className={"connection " + (config.jev ? "online" : "")}>
            <i />
            {config.jev ? "Jev connected" : "Jev not connected"}
          </span>{" "}
          <a
            href="/system.html"
            target="_blank"
            rel="noreferrer"
            className="architecture-link"
          >
            System map <ArrowUpRight size={17} />
          </a>
        </div>
      </section>
      <Tabs value={tab} onValueChange={setTab}>
        <div className="tabrow">
          <TabsList variant="line">
            <TabsTrigger value="flow">
              <Workflow />
              Live flow
            </TabsTrigger>
            <TabsTrigger value="dataset">
              <Database />
              Dataset <span className="count">{samples.length}</span>
            </TabsTrigger>

            <TabsTrigger value="history">
              <Inbox />
              History
            </TabsTrigger>
          </TabsList>
          <span className="micro">TypeSafe AI · {config.jevModel}</span>
        </div>
        <TabsContent value="flow" className="live-workspace">
          <DecisionExperiment
            disabled={liveBusy || !config.jev || !config.gemini}
            onStep={setExperimentStep}
            onActive={setExperimentRunning}
            flow={
              <LiveDecisionFlow
                embedded
                externalStep={experimentStep}
                externalActive={experimentRunning}
                onBusy={setLiveBusy}
                initialMessage={message}
                ready={config.jev && config.gemini}
                onSaved={() => {
                  fetch("/api/history")
                    .then((r) => r.json() as Promise<{ runs: SavedRun[] }>)
                    .then((h) => setHistory(h.runs || []))
                    .catch(() => {});
                }}
              />
            }
          />
        </TabsContent>

        <TabsContent value="history">
          {" "}
          <section className="recent">
            <div className="section-title">
              <h2>Recent assignments</h2>
              <span className="micro">Saved records · latest 100</span>
            </div>
            {history.length ? (
              <div className="history">
                {history.slice(0, 6).map((h) => (
                  <div key={h.id}>
                    <span className="history-time">
                      {new Date(h.createdAt).toLocaleTimeString("en-GB", {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                    <p>{h.message}</p>
                    <span className="history-team">
                      {teams.find((t) => t.id === h.results[0]?.team)?.name ||
                        "Review"}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="empty">
                No records yet. Route your first message to see it here.
              </p>
            )}
          </section>
        </TabsContent>
        <TabsContent value="dataset">
          <section className="dataset-panel panel">
            <p className="eyebrow">BITEXT / HYBRID SYNTHETIC</p>
            <h2>The data behind the messages.</h2>
            <p>
              27 request types (intents), four departments, and a review queue
              for requests outside their scope. These are hybrid synthetic
              samples, not real Shopify customer records.
            </p>
            <p className="dataset-scope">
              <strong>Ready to test — no manual labeling required.</strong> Live
              flow can run all 540 samples, either 270-sample split, or the 12
              demo examples. One round with all samples makes 1,620 measured
              calls across three model settings, plus three warm-ups. Bitext
              intent labels score intent automatically. Other decisions are
              shown without accuracy scores unless reviewed separately. Select a
              card below to try one message manually.
            </p>
            <div className="dataset-stats">
              <strong>
                540 <span>example messages</span>
              </strong>
              <strong>
                27 <span>intents</span>
              </strong>
              <strong>
                2 <span>groups: practice + test</span>
              </strong>
            </div>
            <div className="dataset-diagram">
              <span>
                <Database />
                Bitext · 26,872 messages
              </span>
              <ArrowRight />
              <span>20 samples per intent</span>
              <ArrowRight />
              <span>270 practice / 270 test</span>
            </div>
            <p className="micro">
              Each request type has 20 examples: 10 for practice and 10 for
              testing. These messages evaluate the existing model; they do not
              train it. Fixed sampling seed: 42. Similar templates may occur in
              both splits; results are not a guarantee of production
              performance.{" "}
              <a
                href="https://huggingface.co/datasets/bitext/Bitext-customer-support-llm-chatbot-training-dataset"
                target="_blank"
                rel="noreferrer"
              >
                View source ↗
              </a>
            </p>
            <div className="sample-grid">
              {samples
                .filter((s) => s.split === "dev")
                .filter(
                  (s, i, a) => a.findIndex((x) => x.intent === s.intent) === i,
                )
                .map((s) => (
                  <button
                    disabled={busy || batchActive || autoActive}
                    key={s.id}
                    onClick={() => {
                      choose(s);
                      setTab("flow");
                    }}
                  >
                    <span>{intents[s.intent]?.label}</span>
                    <p>{s.text}</p>
                    <small>
                      {teams.find((t) => t.id === intents[s.intent]?.team)
                        ?.name || "Review"}{" "}
                      <ArrowUpRight size={14} />
                    </small>
                  </button>
                ))}
            </div>
          </section>
        </TabsContent>
      </Tabs>
      <footer>
        <span>
          <Boxes size={15} /> route lab · powered by TypeSafe AI
        </span>
        <span>Demo assignments only. No real store actions.</span>
      </footer>
    </main>
  );
}
function ResultCard({
  result: r,
  expected,
}: {
  result: ModelResult;
  expected?: string;
}) {
  return (
    <section className="result-card">
      <div className="section-title">
        <h3>
          {r.provider === "jev"
            ? "Jev"
            : r.transport === "openrouter"
              ? "Gemini · OpenRouter"
              : "Gemini"}
        </h3>
        <span className="micro">
          {r.model}
          {r.reasoningBudget
            ? ` · thinking on (budget ${r.reasoningBudget})`
            : ""}
        </span>
      </div>
      {r.error ? (
        <p className="error">{r.error}</p>
      ) : (
        <>
          <h4>{r.intent ? intents[r.intent]?.label : "—"}</h4>
          <div className="metric-grid">
            <div>
              <strong>{Math.round(r.latencyMs)} ms</strong>
              <span>API latency</span>
            </div>
            <div>
              <strong>
                {r.costUsd !== undefined ? "$" + r.costUsd.toFixed(6) : "—"}
              </strong>
              <span>Estimated request cost</span>
            </div>
            <div>
              <strong>{r.inputTokens ?? "—"}</strong>
              <span>Input tokens</span>
            </div>
          </div>
          {r.reasoningBudget && (
            <p className="micro">
              Thinking tokens: {r.reasoningTokens ?? "not reported"} · included
              in output usage and cost.
            </p>
          )}
          {expected ? (
            <p className={r.correct ? "truth good" : "truth"}>
              {r.correct ? "✓ Label matched" : "Label did not match"} ·
              Expected: {intents[expected]?.label}
            </p>
          ) : (
            <p className="micro">Custom message: no verified label.</p>
          )}
          {r.probabilities && (
            <div className="probabilities">
              {Object.entries(r.probabilities)
                .sort((a, b) => b[1] - a[1])
                .slice(0, 3)
                .map(([k, v]) => (
                  <div key={k}>
                    <span>{intents[k]?.label || k}</span>
                    <i>
                      <b style={{ width: `${v * 100}%` }} />
                    </i>
                    <strong>{(v * 100).toFixed(1)}%</strong>
                  </div>
                ))}
              <p className="micro">
                Option probabilities · not a guarantee of correctness.
              </p>
            </div>
          )}
        </>
      )}
    </section>
  );
}
