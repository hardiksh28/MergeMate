"use client";
import { use, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { createTwoFilesPatch } from "diff";
import {
  ArrowLeft,
  ArrowRight,
  Brain,
  Check,
  Copy,
  ExternalLink,
  FileCode2,
  GitPullRequest,
  Lightbulb,
  ListChecks,
  Mic,
  PartyPopper,
  Pencil,
  RefreshCw,
  Search,
  Send,
  ShieldCheck,
  Star,
  Wand2,
} from "lucide-react";
import { api, compact, getKeys, logActivity, markStarted, setStage, signInHref, useLocal, useSession } from "@/lib/client";
import type { Explain } from "@/app/api/workspace/context/route";
import { ErrorBox, Loader, Rich } from "@/components/ui";
import { DiffView, diffStat } from "@/components/Diff";
import { CheckStage, type CheckResult } from "@/components/CheckStage";
import { changesetContent, insertOwnWords, parseCheckboxes, toggleCheckbox, type Changeset } from "@/lib/pr";

type Ctx = {
  issue: { number: number; title: string; body: string | null; url: string; author: string; labels: { name: string; color: string }[]; comments: { user: string; body: string }[] };
  repo: { full: string; branch: string; stars: number; description: string | null; language: string | null; avatar: string };
  files: { path: string; why: string; content: string }[];
  searchTerms: string[];
  explain: Explain;
  treeSize: number;
};
type Guess = { verdict: "nailed" | "close" | "off"; feedback: string; nudge: string };
type Fix = {
  rootCause: string;
  steps: { title: string; detail: string }[];
  whyItWorks: string;
  testPlan: string[];
  prTitle: string;
  prBody: string;
  confidence: string;
  changes: { path: string; original: string; updated: string }[];
  failed: string[];
};
type Check = CheckResult;
type State = {
  stage: Stage;
  ctx?: Ctx;
  guess?: string;
  guessResult?: Guess;
  fix?: Fix;
  edited?: Record<string, string>;
  check?: Check;
  title?: string;
  body?: string;
  ownWords?: string;
  prevTitle?: string;
  prevBody?: string;
  changeset?: Changeset | null;
  submitted?: { url: string; number: number };
};
type Stage = "understand" | "find" | "fix" | "check" | "submit";
const STAGES: { id: Stage; label: string; icon: typeof Brain }[] = [
  { id: "understand", label: "Understand", icon: Brain },
  { id: "find", label: "Find it", icon: Search },
  { id: "fix", label: "Prep fix", icon: Wand2 },
  { id: "check", label: "Check", icon: ListChecks },
  { id: "submit", label: "Submit", icon: Send },
];

const storeKey = (id: string) => `mm.ws.${id}`;

export default function Workspace({ params }: { params: Promise<{ owner: string; repo: string; number: string }> }) {
  const { owner, repo, number } = use(params);
  const id = `${owner}/${repo}#${number}`;
  const [s, setS] = useState<State>({ stage: "understand" });
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  const update = useCallback(
    (patch: Partial<State>) => {
      setS((prev) => ({ ...prev, ...patch }));
      if (patch.stage) setStage(id, patch.stage);
    },
    [id],
  );

  // persist progress so a refresh or a later visit resumes where you left off
  useEffect(() => {
    if (!loaded || !s.ctx) return;
    try {
      localStorage.setItem(storeKey(id), JSON.stringify(s));
    } catch {}
  }, [s, loaded, id]);

  const loadContext = useCallback(async () => {
    setBusy("context");
    setError("");
    try {
      const ctx = await api<Ctx>("/api/workspace/context", { method: "POST", json: { owner, repo, number: Number(number) } });
      markStarted(id, { title: ctx.issue.title, repo: ctx.repo.full });
      logActivity("start", { issue: id });
      update({ ctx, stage: "understand" });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  }, [owner, repo, number, id, update]);

  useEffect(() => {
    let saved: State | null = null;
    try {
      saved = JSON.parse(localStorage.getItem(storeKey(id)) || "null");
    } catch {}
    if (saved?.ctx) setS(saved);
    else loadContext();
    setLoaded(true);
  }, [id, loadContext]);

  const ctx = s.ctx;
  const stageIdx = STAGES.findIndex((x) => x.id === s.stage);
  const reached = (st: Stage) => {
    const i = STAGES.findIndex((x) => x.id === st);
    if (i === 0) return !!ctx;
    if (i === 1) return !!ctx;
    if (i === 2) return !!s.guessResult || !!s.fix;
    if (i === 3) return !!s.fix;
    return !!s.check;
  };

  async function checkGuess() {
    if (!ctx || !s.guess?.trim()) return;
    setBusy("guess");
    setError("");
    try {
      const r = await api<Guess>("/api/workspace/check-guess", { method: "POST", json: { issue: ctx.issue, files: ctx.files, searchTerms: ctx.searchTerms, guess: s.guess } });
      update({ guessResult: r });
      logActivity("guess");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  }

  async function makeFix(tweak?: string) {
    if (!ctx) return;
    setBusy("fix");
    setError("");
    try {
      const f = await api<Fix>("/api/workspace/fix", {
        method: "POST",
        json: { issue: ctx.issue, repo: ctx.repo.full, files: ctx.files, searchTerms: ctx.searchTerms, guess: s.guess, tweak },
      });
      update({ fix: f, edited: {}, stage: "fix", title: f.prTitle, body: f.prBody, check: undefined });
      logActivity("fix");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  }

  // Code changes, plus generated files (the changeset) unless codeOnly.
  const finalFiles = (codeOnly = false) => {
    const code = (s.fix?.changes || [])
      .map((c) => ({ path: c.path, original: c.original, updated: s.edited?.[c.path] ?? c.updated }))
      .filter((c) => c.updated !== c.original);
    const cs = s.changeset;
    return codeOnly || !cs?.include || !cs.summary.trim() ? code : [...code, { path: cs.path, original: "", updated: changesetContent(cs) }];
  };

  async function runCheck() {
    if (!ctx || !s.fix) return;
    setBusy("check");
    setError("");
    try {
      const files = finalFiles(true);
      const diff = files.map((f) => createTwoFilesPatch(f.path, f.path, f.original, f.updated, "", "", { context: 2 })).join("\n");
      const r = await api<Check>("/api/workspace/contributing", {
        method: "POST",
        json: {
          repo: ctx.repo.full,
          branch: ctx.repo.branch,
          issueNumber: ctx.issue.number,
          issueTitle: ctx.issue.title,
          prTitle: s.title,
          prBody: s.body,
          changedPaths: files.map((f) => f.path),
          diff,
        },
      });
      // Keep boxes the contributor already ticked when the body is regenerated.
      const ticked = new Set(parseCheckboxes(s.body || "").filter((b) => b.checked).map((b) => b.label.toLowerCase()));
      let body = r.fixedBody;
      for (const b of parseCheckboxes(body)) if (!b.checked && ticked.has(b.label.toLowerCase())) body = toggleCheckbox(body, b.line, true);
      const prev = s.changeset;
      update({
        check: r,
        stage: "check",
        prevTitle: s.prevTitle ?? s.title,
        prevBody: s.prevBody ?? s.body,
        title: r.fixedTitle,
        body,
        changeset: r.changeset
          ? { ...r.changeset, include: prev?.include ?? true, summary: prev?.path === r.changeset.path ? prev.summary : r.changeset.summary, bump: prev?.bump ?? r.changeset.bump }
          : null,
      });
      logActivity("check");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  }

  async function submit(draft: boolean) {
    if (!ctx) return;
    setBusy("submit");
    setError("");
    try {
      const body = insertOwnWords(s.body || "", s.ownWords || "");
      const r = await api<{ url: string; number: number }>("/api/workspace/submit", {
        method: "POST",
        json: {
          repo: ctx.repo.full,
          branch: ctx.repo.branch,
          issueNumber: ctx.issue.number,
          title: s.title,
          body,
          draft,
          files: finalFiles().map((f) => ({ path: f.path, content: f.updated })),
          dco: !!s.check?.dco,
        },
      });
      update({ submitted: r });
      logActivity("pr", { issue: id, url: r.url });
      setStage(id, "submitted");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  }

  if (!loaded) return null;

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-8">
      <Link href="/app" className="btn-quiet -ml-3 mb-4"><ArrowLeft className="h-4 w-4" /> Matches</Link>

      {!ctx && (
        <div className="card p-8">
          {busy === "context" && (
            <>
              <Loader lines={["Cloning the vibe of the repo…", "Mapping the file tree…", "Finding the 3 files that matter…", "Writing you a plain-English tour…"]} />
              <div className="mt-6 space-y-3">{[0, 1, 2].map((i) => <div key={i} className="skeleton h-16" />)}</div>
            </>
          )}
          {error && <ErrorBox error={error} onRetry={loadContext} />}
        </div>
      )}

      {ctx && (
        <>
          <header className="mb-6">
            <div className="flex flex-wrap items-center gap-2 text-sm text-muted">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={ctx.repo.avatar} alt="" className="h-5 w-5 rounded-md" />
              <span className="text-ink/80">{ctx.repo.full}</span>
              <span className="inline-flex items-center gap-1"><Star className="h-3.5 w-3.5" /> {compact(ctx.repo.stars)}</span>
              <span>· {ctx.treeSize.toLocaleString()} files, we picked {ctx.files.length}</span>
              <a href={ctx.issue.url} target="_blank" rel="noreferrer" className="ml-auto inline-flex items-center gap-1 hover:text-ink">#{ctx.issue.number} <ExternalLink className="h-3.5 w-3.5" /></a>
            </div>
            <h1 className="font-display mt-2 text-3xl font-extrabold leading-tight sm:text-4xl">{ctx.issue.title}</h1>
          </header>

          <div className="grid gap-6 lg:grid-cols-[210px_1fr]">
            <nav className="scroll-thin flex gap-1 overflow-x-auto lg:sticky lg:top-6 lg:flex-col lg:self-start">
              {STAGES.map((st, i) => {
                const active = s.stage === st.id;
                const done = i < stageIdx || (st.id === "submit" && s.submitted);
                const can = reached(st.id);
                return (
                  <button
                    key={st.id}
                    disabled={!can}
                    onClick={() => update({ stage: st.id })}
                    className={`flex shrink-0 items-center gap-3 rounded-2xl px-3 py-2.5 text-sm font-medium transition disabled:opacity-40 ${active ? "bg-lime text-lime-ink" : "text-muted hover:bg-surface-2 hover:text-ink"}`}
                  >
                    <span className={`flex h-6 w-6 items-center justify-center rounded-full text-[11px] ${active ? "bg-lime-ink/15" : done ? "bg-lime/20 text-lime" : "bg-surface-3"}`}>
                      {done && !active ? <Check className="h-3.5 w-3.5" /> : i + 1}
                    </span>
                    {st.label}
                  </button>
                );
              })}
            </nav>

            <div className="min-w-0 space-y-5">
              {error && <ErrorBox error={error} />}

              {s.stage === "understand" && <Understand ctx={ctx} onNext={() => update({ stage: "find" })} />}

              {s.stage === "find" && (
                <section className="space-y-5 animate-rise">
                  <div className="card p-6">
                    <div className="flex items-center gap-2 text-violet"><Search className="h-5 w-5" /><p className="label text-violet">your turn</p></div>
                    <h2 className="font-display mt-3 text-2xl font-bold"><Rich text={ctx.explain.challenge} /></h2>
                    <p className="mt-2 text-sm text-muted">Take a real guess: which file, which function, what&apos;s wrong. Being wrong is fine. This is the part that makes you better (and what you&apos;ll talk about in interviews).</p>
                    <textarea
                      className="input mt-5 min-h-28 font-mono text-[13px]"
                      placeholder="I think the bug is in … because …"
                      value={s.guess || ""}
                      onChange={(e) => update({ guess: e.target.value })}
                    />
                    <div className="mt-3 flex flex-wrap gap-2">
                      <button className="btn-lime" disabled={!s.guess?.trim() || !!busy} onClick={checkGuess}>
                        {busy === "guess" ? "Checking…" : "Check my guess"}
                      </button>
                      <button className="btn-quiet" disabled={!!busy} onClick={() => makeFix()}>Skip, show me the fix</button>
                    </div>
                  </div>
                  {s.guessResult && (
                    <div className={`card animate-rise p-6 ${s.guessResult.verdict === "nailed" ? "border-lime/40 bg-lime/[0.06]" : s.guessResult.verdict === "close" ? "border-sky/40 bg-sky/[0.05]" : "border-orange/40 bg-orange/[0.05]"}`}>
                      <p className="font-display text-2xl font-extrabold">
                        {s.guessResult.verdict === "nailed" ? "🎯 Nailed it." : s.guessResult.verdict === "close" ? "🔥 So close." : "🤔 Not quite, but good instinct."}
                      </p>
                      <p className="mt-2 text-ink/85"><Rich text={s.guessResult.feedback} /></p>
                      <p className="mt-3 flex gap-2 text-sm text-muted"><Lightbulb className="mt-0.5 h-4 w-4 shrink-0 text-orange" /><Rich text={s.guessResult.nudge} /></p>
                      <div className="mt-5 flex flex-wrap gap-2">
                        <button className="btn-lime" disabled={!!busy} onClick={() => makeFix()}>
                          <Wand2 className="h-4 w-4" /> Prep the fix with me
                        </button>
                        {s.guessResult.verdict !== "nailed" && <button className="btn-ghost" onClick={() => update({ guessResult: undefined })}>Guess again</button>}
                      </div>
                    </div>
                  )}
                  {busy === "fix" && <Loader lines={["Drafting the smallest possible change…", "Matching the repo's code style…", "Writing the why, not just the what…"]} />}
                </section>
              )}

              {s.stage === "fix" && s.fix && (
                <FixStage
                  fix={s.fix}
                  edited={s.edited || {}}
                  busy={busy}
                  onEdit={(path, v) => update({ edited: { ...(s.edited || {}), [path]: v } })}
                  onRegenerate={(t) => makeFix(t)}
                  onNext={runCheck}
                />
              )}

              {s.stage === "check" && s.check && (
                <CheckStage
                  check={s.check}
                  title={s.title || ""}
                  body={s.body || ""}
                  changeset={s.changeset || null}
                  canUndo={s.prevBody !== undefined && s.prevBody !== s.body}
                  busy={busy}
                  onTitle={(v) => update({ title: v })}
                  onBody={(v) => update({ body: v })}
                  onChangeset={(c) => update({ changeset: c })}
                  onUndo={() => update({ title: s.prevTitle, body: s.prevBody, prevTitle: undefined, prevBody: undefined })}
                  onRecheck={runCheck}
                  onNext={() => update({ stage: "submit" })}
                />
              )}
              {busy === "check" && s.stage !== "check" && <Loader lines={["Reading CONTRIBUTING.md…", "Checking the PR template…", "Making sure maintainers will like it…"]} />}

              {s.stage === "submit" && (
                <SubmitStage
                  s={s}
                  ctx={ctx}
                  busy={busy}
                  files={finalFiles()}
                  onOwnWords={(v) => update({ ownWords: v })}
                  onSubmit={submit}
                />
              )}
            </div>
          </div>
        </>
      )}
    </main>
  );
}

function Understand({ ctx, onNext }: { ctx: Ctx; onNext: () => void }) {
  const [open, setOpen] = useState<string | null>(null);
  const e = ctx.explain;
  return (
    <section className="space-y-5 animate-rise">
      <div className="card p-6">
        <div className="flex items-center gap-2 text-lime"><Brain className="h-5 w-5" /><p className="label text-lime">tl;dr</p></div>
        <p className="font-display mt-3 text-2xl font-bold leading-snug"><Rich text={e.tldr} /></p>
        <p className="mt-3 text-ink/75"><Rich text={e.whatsBroken} /></p>
      </div>

      <div className="card p-6">
        <p className="label">How this part of the code works</p>
        <ol className="mt-4 space-y-3">
          {e.howItWorks.map((step, i) => (
            <li key={i} className="flex gap-3">
              <span className="font-display flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-surface-3 text-sm font-bold text-lime">{i + 1}</span>
              <p className="pt-0.5 text-ink/85"><Rich text={step} /></p>
            </li>
          ))}
        </ol>
      </div>

      <div className="card p-6">
        <p className="label">The files that matter</p>
        <div className="mt-4 space-y-2">
          {ctx.files.map((f) => {
            const m = e.fileMap.find((x) => x.path === f.path);
            const imp = m?.importance || "related";
            return (
              <div key={f.path} className="overflow-hidden rounded-2xl border border-line bg-surface-2">
                <button className="flex w-full items-center gap-3 p-3 text-left" onClick={() => setOpen(open === f.path ? null : f.path)}>
                  <FileCode2 className={`h-5 w-5 shrink-0 ${imp === "core" ? "text-lime" : imp === "related" ? "text-sky" : "text-muted"}`} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-mono text-sm">{f.path}</p>
                    <p className="text-xs text-muted"><Rich text={m?.role || f.why} /></p>
                  </div>
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${imp === "core" ? "bg-lime/15 text-lime" : "bg-surface-3 text-muted"}`}>{imp}</span>
                </button>
                {open === f.path && (
                  <pre className="scroll-thin max-h-96 overflow-auto border-t border-line bg-bg p-4 font-mono text-[12px] leading-relaxed text-ink/80">{f.content.slice(0, 20000)}</pre>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {e.glossary?.length > 0 && (
        <div className="card p-6">
          <p className="label">Project lingo</p>
          <dl className="mt-4 grid gap-3 sm:grid-cols-2">
            {e.glossary.map((g) => (
              <div key={g.term} className="rounded-2xl bg-surface-2 p-3">
                <dt className="font-mono text-sm text-lime">{g.term}</dt>
                <dd className="mt-1 text-sm text-muted">{g.meaning}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}

      <button className="btn-lime w-full py-3.5 text-base sm:w-auto" onClick={onNext}>Got it, let me find the bug <ArrowRight className="h-4 w-4" /></button>
    </section>
  );
}

function FixStage({
  fix,
  edited,
  busy,
  onEdit,
  onRegenerate,
  onNext,
}: {
  fix: Fix;
  edited: Record<string, string>;
  busy: string;
  onEdit: (path: string, v: string) => void;
  onRegenerate: (tweak: string) => void;
  onNext: () => void;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const [tweak, setTweak] = useState("");
  return (
    <section className="space-y-5 animate-rise">
      <div className="card p-6">
        <div className="flex items-center gap-2 text-pink"><Wand2 className="h-5 w-5" /><p className="label text-pink">what was wrong</p></div>
        <p className="font-display mt-3 text-xl font-bold leading-snug"><Rich text={fix.rootCause} /></p>
        <ol className="mt-5 space-y-3">
          {fix.steps.map((st, i) => (
            <li key={i} className="flex gap-3">
              <span className="font-display flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-surface-3 text-sm font-bold text-pink">{i + 1}</span>
              <div>
                <p className="font-semibold"><Rich text={st.title} /></p>
                <p className="text-sm text-muted"><Rich text={st.detail} /></p>
              </div>
            </li>
          ))}
        </ol>
        <p className="mt-5 rounded-2xl bg-surface-2 p-4 text-sm text-ink/85"><span className="font-semibold text-lime">Why it works: </span><Rich text={fix.whyItWorks} /></p>
      </div>

      {fix.failed.length > 0 && (
        <div className="rounded-2xl border border-orange/30 bg-orange/5 p-4 text-sm text-orange">
          {fix.failed.length} edit(s) couldn&apos;t be applied cleanly. Regenerate or edit the file by hand.
        </div>
      )}
      {!fix.changes.length && (
        <div className="rounded-2xl border border-orange/30 bg-orange/5 p-4 text-sm text-orange">No code change was produced. Try regenerating with more direction below.</div>
      )}

      {fix.changes.map((c) => {
        const current = edited[c.path] ?? c.updated;
        return (
          <div key={c.path} className="space-y-2">
            <div className="flex items-center justify-end">
              <button className="btn-quiet py-1 text-xs" onClick={() => setEditing(editing === c.path ? null : c.path)}>
                <Pencil className="h-3.5 w-3.5" /> {editing === c.path ? "Done editing" : "Edit by hand"}
              </button>
            </div>
            {editing === c.path ? (
              <textarea className="input min-h-96 font-mono text-[12px] leading-relaxed" value={current} onChange={(e) => onEdit(c.path, e.target.value)} spellCheck={false} />
            ) : (
              <DiffView path={c.path} original={c.original} updated={current} />
            )}
          </div>
        );
      })}

      <div className="card p-6">
        <p className="label">How to verify</p>
        <ul className="mt-3 space-y-1.5 text-sm text-ink/85">
          {fix.testPlan.map((t, i) => <li key={i} className="flex gap-2"><Check className="mt-0.5 h-4 w-4 shrink-0 text-lime" /><Rich text={t} /></li>)}
        </ul>
      </div>

      <div className="card p-4">
        <p className="label mb-2 px-1">Not quite right? Tell your mate</p>
        <div className="flex flex-col gap-2 sm:flex-row">
          <input className="input" placeholder="e.g. keep it smaller, don't touch the tests, use the existing helper…" value={tweak} onChange={(e) => setTweak(e.target.value)} />
          <button className="btn-ghost shrink-0" disabled={!!busy} onClick={() => onRegenerate(tweak)}>
            <RefreshCw className={`h-4 w-4 ${busy === "fix" ? "animate-spin" : ""}`} /> Regenerate
          </button>
        </div>
      </div>

      {busy === "fix" && <Loader lines={["Reworking the draft…", "Keeping it minimal…"]} />}
      <button className="btn-lime w-full py-3.5 text-base sm:w-auto" disabled={!!busy || !fix.changes.length} onClick={onNext}>
        {busy === "check" ? "Checking the rules…" : <>I&apos;ve reviewed the diff, check it <ArrowRight className="h-4 w-4" /></>}
      </button>
    </section>
  );
}

function SubmitStage({
  s,
  ctx,
  busy,
  files,
  onOwnWords,
  onSubmit,
}: {
  s: State;
  ctx: Ctx;
  busy: string;
  files: { path: string; original: string; updated: string }[];
  onOwnWords: (v: string) => void;
  onSubmit: (draft: boolean) => void;
}) {
  const [read, setRead] = useState(false);
  const [tested, setTested] = useState(false);
  const [draft, setDraft] = useState(true);
  const needsCla = !!s.check?.cla?.required;
  const [cla, setCla] = useState(false);
  const [copied, setCopied] = useState(false);
  const session = useSession();
  const [hasPat] = useState(() => (typeof window !== "undefined" ? !!getKeys().github : false));
  const hasToken = !!session.user || hasPat;
  const [profile] = useLocal<{ username: string } | null>("profile", null);
  const words = (s.ownWords || "").trim();
  const ready = read && tested && words.length >= 40 && (!needsCla || cla);
  const stat = files.reduce((acc, f) => { const d = diffStat(f.original, f.updated); return { add: acc.add + d.add, del: acc.del + d.del }; }, { add: 0, del: 0 });

  if (s.submitted) {
    return (
      <section className="card animate-rise relative overflow-hidden p-8 text-center">
        <div className="glow-lime pointer-events-none absolute inset-0" />
        <div className="relative">
          <PartyPopper className="mx-auto h-12 w-12 text-lime" />
          <h2 className="font-display mt-4 text-4xl font-extrabold">PR #{s.submitted.number} is live.</h2>
          <p className="mx-auto mt-2 max-w-md text-muted">That&apos;s real open source work with your name on it. We&apos;ll track it and help you handle review comments.</p>
          <div className="mt-6 flex flex-col justify-center gap-2 sm:flex-row">
            <a href={s.submitted.url} target="_blank" rel="noreferrer" className="btn-lime"><GitPullRequest className="h-4 w-4" /> View on GitHub</a>
            <Link href={`/app/prs?prep=${encodeURIComponent(`${ctx.repo.full}#${s.submitted.number}`)}`} className="btn-ghost"><Mic className="h-4 w-4" /> Prep to talk about it</Link>
            {profile && <Link href={`/u/${profile.username}`} className="btn-ghost">See my profile</Link>}
          </div>
        </div>
      </section>
    );
  }

  const patch = files.map((f) => createTwoFilesPatch(`a/${f.path}`, `b/${f.path}`, f.original, f.updated)).join("\n");

  return (
    <section className="space-y-5 animate-rise">
      <div className="card p-6">
        <div className="flex items-center gap-2 text-orange"><ShieldCheck className="h-5 w-5" /><p className="label text-orange">you&apos;re the one shipping this</p></div>
        <h2 className="font-display mt-3 text-2xl font-bold">Explain the change in your own words.</h2>
        <p className="mt-1 text-sm text-muted">This goes at the top of your PR. Maintainers love it, and it&apos;s exactly what you&apos;ll say in interviews.</p>
        <textarea className="input mt-4 min-h-28" placeholder="The issue happened because … so I changed … which means …" value={s.ownWords || ""} onChange={(e) => onOwnWords(e.target.value)} />
        <p className={`mt-1 text-right text-xs ${words.length >= 40 ? "text-lime" : "text-muted"}`}>{words.length}/40 min</p>

        <div className="mt-4 space-y-2">
          {[
            [read, setRead, `I read the full diff (${files.length} file${files.length === 1 ? "" : "s"}, +${stat.add} −${stat.del})`],
            [tested, setTested, "I tested it locally, or listed how to test it in the PR"],
            ...(needsCla ? [[cla, setCla, "I've signed this project's Contributor License Agreement (CLA)"]] : []),
            [draft, setDraft, "Open as a draft PR first (recommended for your first PR in a repo)"],
          ].map(([v, set, label], i) => (
            <label key={i} className="flex cursor-pointer items-center gap-3 rounded-2xl bg-surface-2 p-3 text-sm">
              <input type="checkbox" checked={v as boolean} onChange={(e) => (set as (b: boolean) => void)(e.target.checked)} className="h-4 w-4 accent-[var(--lime)]" />
              {label as string}
            </label>
          ))}
        </div>
      </div>

      <div className="card p-6">
        <p className="label">Ready to ship</p>
        <p className="font-display mt-2 text-xl font-bold">{s.title}</p>
        <p className="mt-1 text-sm text-muted">to {ctx.repo.full}:{ctx.repo.branch}, from {session.user ? `@${session.user.login}'s` : "your"} fork</p>
        {hasToken ? (
          <button className="btn-lime mt-5 w-full py-3.5 text-base" disabled={!ready || !!busy} onClick={() => onSubmit(draft)}>
            {busy === "submit" ? "Forking, committing, opening PR…" : <><Send className="h-4 w-4" /> Open PR on GitHub</>}
          </button>
        ) : (
          <div className="mt-5 rounded-2xl border border-line bg-surface-2 p-4 text-sm">
            <p>Sign in with GitHub to open the PR from your account in one click. Your progress here is saved.</p>
            {session.configured ? (
              <a href={signInHref(`/app/issue/${ctx.repo.full}/${ctx.issue.number}`)} className="btn-lime mt-3">Sign in with GitHub</a>
            ) : (
              <Link href="/app/settings" className="btn-lime mt-3">Connect GitHub</Link>
            )}
          </div>
        )}
        {!ready && <p className="mt-3 text-center text-xs text-muted">Tick the required boxes and write ≥40 chars in your own words to unlock submit.</p>}
        <div className="mt-5 flex flex-wrap gap-2 border-t border-line pt-4">
          <button className="btn-quiet text-xs" onClick={() => { navigator.clipboard.writeText(patch); setCopied(true); setTimeout(() => setCopied(false), 1500); }}>
            {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />} Copy as .patch
          </button>
          <a className="btn-quiet text-xs" href={ctx.issue.url} target="_blank" rel="noreferrer"><ExternalLink className="h-3.5 w-3.5" /> Comment on the issue first</a>
        </div>
      </div>
    </section>
  );
}
