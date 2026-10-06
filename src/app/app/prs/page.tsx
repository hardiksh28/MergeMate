"use client";
import { Suspense, useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Check, Copy, ExternalLink, GitMerge, GitPullRequest, GitPullRequestDraft, MessageCircle, MessageSquareReply, Mic, X, CircleX } from "lucide-react";
import { api, logActivity, timeAgo, useLocal, type Profile } from "@/lib/client";
import type { PRItem } from "@/app/api/prs/route";
import type { Prep } from "@/app/api/interview/route";
import { ErrorBox, Loader, Rich } from "@/components/ui";

type Comment = { user: string; body: string; at: string; kind: string; path?: string; hunk?: string };
type Reply = { meaning: string; reply: string; todo: string[] };

const STATUS = {
  open: { icon: GitPullRequest, c: "text-lime", bg: "bg-lime/10", label: "Open" },
  draft: { icon: GitPullRequestDraft, c: "text-muted", bg: "bg-surface-3", label: "Draft" },
  merged: { icon: GitMerge, c: "text-violet", bg: "bg-violet/10", label: "Merged" },
  closed: { icon: CircleX, c: "text-red", bg: "bg-red/10", label: "Closed" },
} as const;

export default function PRsPage() {
  return (
    <Suspense>
      <PRs />
    </Suspense>
  );
}

function PRs() {
  const [profile] = useLocal<Profile | null>("profile", null);
  const [prs, setPrs] = useState<PRItem[] | null>(null);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<"all" | PRItem["status"]>("all");
  const [sel, setSel] = useState<{ pr: PRItem; tab: "comments" | "prep" } | null>(null);
  const params = useSearchParams();

  const load = useCallback(async () => {
    if (!profile) return;
    setError("");
    try {
      const d = await api<{ prs: PRItem[] }>(`/api/prs?username=${profile.username}`);
      setPrs(d.prs);
      const prep = params.get("prep");
      if (prep) {
        const hit = d.prs.find((p) => p.id.toLowerCase() === prep.toLowerCase());
        if (hit) setSel({ pr: hit, tab: "prep" });
      }
    } catch (e) {
      setError((e as Error).message);
    }
  }, [profile, params]);

  useEffect(() => {
    load();
  }, [load]);

  const list = (prs || []).filter((p) => filter === "all" || p.status === filter);
  const counts = (prs || []).reduce<Record<string, number>>((a, p) => ({ ...a, [p.status]: (a[p.status] || 0) + 1 }), {});

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-8">
      <h1 className="font-display text-4xl font-extrabold sm:text-5xl">Your PRs</h1>
      <p className="mt-2 text-muted">Every open source PR you&apos;ve opened, tracked live from GitHub.</p>

      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {(["open", "draft", "merged", "closed"] as const).map((k) => {
          const S = STATUS[k];
          return (
            <button key={k} onClick={() => setFilter(filter === k ? "all" : k)} className={`card flex items-center gap-3 p-4 text-left transition ${filter === k ? "border-lime/60" : ""}`}>
              <span className={`flex h-10 w-10 items-center justify-center rounded-2xl ${S.bg}`}><S.icon className={`h-5 w-5 ${S.c}`} /></span>
              <div>
                <p className="font-display text-2xl font-extrabold">{prs ? counts[k] || 0 : "–"}</p>
                <p className="text-xs text-muted">{S.label}</p>
              </div>
            </button>
          );
        })}
      </div>

      {error && <div className="mt-6"><ErrorBox error={error} onRetry={load} /></div>}
      {!prs && !error && <div className="mt-6 space-y-3">{[0, 1, 2].map((i) => <div key={i} className="skeleton h-20" />)}</div>}
      {prs && !prs.length && (
        <div className="card mt-6 p-10 text-center">
          <p className="text-4xl">🌱</p>
          <p className="font-display mt-3 text-2xl font-bold">No PRs yet. Let&apos;s fix that.</p>
          <a href="/app" className="btn-lime mt-5">Find an issue</a>
        </div>
      )}

      <div className="mt-6 space-y-3">
        {list.map((p) => {
          const S = STATUS[p.status];
          return (
            <div key={p.id} className="card flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
              <div className="flex min-w-0 flex-1 items-start gap-3">
                <S.icon className={`mt-1 h-5 w-5 shrink-0 ${S.c}`} />
                <div className="min-w-0">
                  <p className="truncate font-semibold">{p.title}</p>
                  <p className="text-xs text-muted">{p.repo}#{p.number} · opened {timeAgo(p.createdAt)} · <MessageCircle className="inline h-3 w-3" /> {p.comments}</p>
                </div>
              </div>
              <div className="flex shrink-0 gap-2">
                <button className="btn-ghost py-1.5 text-xs" onClick={() => setSel({ pr: p, tab: "comments" })}><MessageSquareReply className="h-3.5 w-3.5" /> Reviews</button>
                <button className="btn-ghost py-1.5 text-xs" onClick={() => setSel({ pr: p, tab: "prep" })}><Mic className="h-3.5 w-3.5" /> Interview prep</button>
                <a href={p.url} target="_blank" rel="noreferrer" className="btn-quiet px-2" aria-label="Open on GitHub"><ExternalLink className="h-4 w-4" /></a>
              </div>
            </div>
          );
        })}
      </div>

      {sel && <Drawer pr={sel.pr} tab={sel.tab} onTab={(tab) => setSel({ ...sel, tab })} onClose={() => setSel(null)} />}
    </main>
  );
}

function Drawer({ pr, tab, onTab, onClose }: { pr: PRItem; tab: "comments" | "prep"; onTab: (t: "comments" | "prep") => void; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-[80] flex justify-end bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <aside className="scroll-thin h-full w-full max-w-2xl overflow-y-auto border-l border-line bg-bg p-6 animate-rise" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-xs text-muted">{pr.repo}#{pr.number}</p>
            <h2 className="font-display mt-1 text-2xl font-bold leading-tight">{pr.title}</h2>
          </div>
          <button onClick={onClose} className="text-muted hover:text-ink" aria-label="Close"><X className="h-5 w-5" /></button>
        </div>
        <div className="mt-5 inline-flex rounded-full border border-line bg-surface p-1 text-sm">
          {(["comments", "prep"] as const).map((t) => (
            <button key={t} onClick={() => onTab(t)} className={`rounded-full px-4 py-1.5 font-semibold transition ${tab === t ? "bg-ink text-bg" : "text-muted"}`}>
              {t === "comments" ? "Review comments" : "Interview prep"}
            </button>
          ))}
        </div>
        <div className="mt-6">{tab === "comments" ? <Comments pr={pr} /> : <PrepPanel pr={pr} />}</div>
      </aside>
    </div>
  );
}

function Comments({ pr }: { pr: PRItem }) {
  const [comments, setComments] = useState<Comment[] | null>(null);
  const [error, setError] = useState("");
  const [profile] = useLocal<Profile | null>("profile", null);
  useEffect(() => {
    api<{ comments: Comment[] }>(`/api/prs?detail=${encodeURIComponent(pr.id)}`).then((d) => setComments(d.comments)).catch((e) => setError(e.message));
  }, [pr.id]);
  if (error) return <ErrorBox error={error} />;
  if (!comments) return <Loader lines={["Loading the conversation…"]} />;
  const theirs = comments.filter((c) => c.user.toLowerCase() !== profile?.username.toLowerCase() && !/\[bot\]$/.test(c.user));
  if (!theirs.length) return <div className="card p-8 text-center text-muted">No maintainer comments yet. We&apos;ll be here when they land 👀</div>;
  return (
    <div className="space-y-4">
      {theirs.map((c, i) => <CommentCard key={i} c={c} pr={pr} />)}
    </div>
  );
}

function CommentCard({ c, pr }: { c: Comment; pr: PRItem }) {
  const [reply, setReply] = useState<Reply | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [intent, setIntent] = useState("");
  const [copied, setCopied] = useState(false);
  async function go() {
    setBusy(true);
    setError("");
    try {
      setReply(await api<Reply>("/api/prs/reply", { method: "POST", json: { pr, comment: c, intent } }));
      logActivity("reply");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="card p-5">
      <p className="text-xs text-muted">@{c.user} · {c.kind} · {timeAgo(c.at)}{c.path && <> · <span className="font-mono">{c.path}</span></>}</p>
      {c.hunk && <pre className="scroll-thin mt-2 overflow-x-auto rounded-xl bg-surface-2 p-3 font-mono text-[11px] text-muted">{c.hunk}</pre>}
      <p className="mt-2 whitespace-pre-wrap text-sm text-ink/90">{c.body}</p>
      {!reply && (
        <div className="mt-4 flex flex-col gap-2 sm:flex-row">
          <input className="input py-2" placeholder="optional: what do you want to say? (agree, push back, ask…)" value={intent} onChange={(e) => setIntent(e.target.value)} />
          <button className="btn-lime shrink-0 py-2" onClick={go} disabled={busy}>{busy ? "Decoding…" : "Decode + draft reply"}</button>
        </div>
      )}
      {error && <div className="mt-3"><ErrorBox error={error} /></div>}
      {reply && (
        <div className="mt-4 space-y-3 animate-rise">
          <p className="rounded-2xl bg-sky/10 p-3 text-sm"><span className="font-semibold text-sky">What they mean: </span><Rich text={reply.meaning} /></p>
          {reply.todo.length > 0 && (
            <ul className="space-y-1 text-sm">{reply.todo.map((t, i) => <li key={i} className="flex gap-2"><Check className="mt-0.5 h-4 w-4 shrink-0 text-lime" /><Rich text={t} /></li>)}</ul>
          )}
          <div className="rounded-2xl border border-line bg-surface-2 p-3">
            <p className="whitespace-pre-wrap text-sm">{reply.reply}</p>
            <div className="mt-3 flex gap-2">
              <button className="btn-ghost py-1.5 text-xs" onClick={() => { navigator.clipboard.writeText(reply.reply); setCopied(true); setTimeout(() => setCopied(false), 1500); }}>
                {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />} Copy
              </button>
              <a className="btn-ghost py-1.5 text-xs" href={pr.url} target="_blank" rel="noreferrer">Reply on GitHub <ExternalLink className="h-3.5 w-3.5" /></a>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function PrepPanel({ pr }: { pr: PRItem }) {
  const [cache, setCache] = useLocal<Record<string, Prep>>("prep", {});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [reveal, setReveal] = useState<number | null>(null);
  const prep = cache[pr.id];

  const go = useCallback(async () => {
    setBusy(true);
    setError("");
    try {
      const p = await api<Prep>("/api/interview", { method: "POST", json: { repo: pr.repo, number: pr.number, title: pr.title, body: pr.body } });
      setCache((c) => ({ ...c, [pr.id]: p }));
      logActivity("prep");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, [pr, setCache]);

  if (error) return <ErrorBox error={error} onRetry={go} />;
  if (!prep) {
    return (
      <div className="card p-8 text-center">
        <Mic className="mx-auto h-10 w-10 text-pink" />
        <p className="font-display mt-3 text-2xl font-bold">Turn this PR into an interview story.</p>
        <p className="mt-2 text-sm text-muted">30-sec pitch, a STAR answer and the questions you&apos;ll get, built from your actual diff.</p>
        {busy ? <Loader className="mt-5 justify-center" lines={["Reading your diff…", "Thinking like an interviewer…"]} /> : <button className="btn-lime mt-5" onClick={go}>Generate prep</button>}
      </div>
    );
  }
  return (
    <div className="space-y-4 animate-rise">
      <div className="card p-5">
        <p className="label text-pink">30-second pitch</p>
        <p className="mt-2 text-ink/90">{prep.pitch}</p>
        <div className="mt-3 flex flex-wrap gap-1.5">{prep.skills.map((s) => <span key={s} className="chip">{s}</span>)}</div>
      </div>
      <div className="card grid gap-3 p-5 sm:grid-cols-2">
        {(["situation", "task", "action", "result"] as const).map((k) => (
          <div key={k} className="rounded-2xl bg-surface-2 p-3">
            <p className="label text-lime">{k}</p>
            <p className="mt-1 text-sm text-ink/85">{prep.star[k]}</p>
          </div>
        ))}
      </div>
      <div className="space-y-2">
        <p className="label">Practice questions: answer out loud, then reveal</p>
        {prep.questions.map((q, i) => (
          <div key={i} className="card p-4">
            <p className="font-semibold">{q.q}</p>
            {reveal === i ? <p className="mt-2 text-sm text-muted animate-rise">{q.answer}</p> : <button className="mt-2 text-xs font-semibold text-lime" onClick={() => setReveal(i)}>Reveal model answer</button>}
          </div>
        ))}
      </div>
      <button className="btn-quiet text-xs" onClick={go} disabled={busy}>{busy ? "Regenerating…" : "Regenerate"}</button>
    </div>
  );
}
