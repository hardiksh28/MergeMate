"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, Clock, ExternalLink, Flame, MessageCircle, RefreshCw, Sparkles, Star, Target } from "lucide-react";
import { api, canStart, compact, timeAgo, useLocal, type Profile } from "@/lib/client";
import type { Match } from "@/app/api/match/route";
import type { PRItem } from "@/app/api/prs/route";
import { DifficultyPill, ErrorBox, Loader } from "@/components/ui";
import { Paywall } from "@/components/Paywall";

type Started = Record<string, { title: string; repo: string; at: string; stage: string }>;

export default function Dashboard() {
  const [profile] = useLocal<Profile | null>("profile", null);
  const [started] = useLocal<Started>("started", {});
  const [matches, setMatches] = useState<Match[] | null>(null);
  const [error, setError] = useState("");
  const [lang, setLang] = useState<string>("all");
  const [diff, setDiff] = useState<string>("all");
  const [loading, setLoading] = useState(false);
  const [stats, setStats] = useState<{ week: number; streak: number } | null>(null);
  const [paywall, setPaywall] = useState<Match | null>(null);
  const router = useRouter();

  const load = useCallback(async () => {
    if (!profile) return;
    setLoading(true);
    setError("");
    try {
      const q = new URLSearchParams({
        username: profile.username,
        langs: profile.languages.slice(0, 3).join(","),
        skills: profile.skills.join(","),
        level: profile.level,
        limit: "24",
      });
      const d = await api<{ matches: Match[] }>(`/api/match?${q}`);
      setMatches(d.matches);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [profile]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!profile) return;
    Promise.all([
      api<{ prs: PRItem[] }>(`/api/prs?username=${profile.username}`).catch(() => ({ prs: [] as PRItem[] })),
      api<{ stats: { current: number } }>(`/api/public/${profile.username}?lite=1`).catch(() => null),
    ]).then(([p, pub]) => {
      const weekStart = new Date();
      weekStart.setDate(weekStart.getDate() - ((weekStart.getDay() + 6) % 7));
      weekStart.setHours(0, 0, 0, 0);
      setStats({
        week: p.prs.filter((x) => new Date(x.createdAt) >= weekStart).length,
        streak: pub?.stats.current ?? 0,
      });
    });
  }, [profile]);

  const filtered = useMemo(
    () => (matches || []).filter((m) => (lang === "all" || m.language === lang) && (diff === "all" || m.difficulty === diff)),
    [matches, lang, diff],
  );
  const inProgress = Object.entries(started).filter(([, s]) => s.stage !== "submitted").slice(-3).reverse();

  function start(m: Match) {
    if (!canStart(m.id)) return setPaywall(m);
    router.push(`/app/issue/${m.owner}/${m.repo}/${m.number}`);
  }

  if (!profile) return null;
  const goal = profile.weeklyGoal || 2;
  const pct = Math.min(1, (stats?.week || 0) / goal);
  const hour = new Date().getHours();
  const hi = hour < 12 ? "gm" : hour < 18 ? "hey" : "evening";

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-8">
      <section className="grid gap-4 lg:grid-cols-[1fr_auto]">
        <div>
          <p className="text-sm text-muted">{hi}, {profile.name?.split(" ")[0] || profile.username} 👋</p>
          <h1 className="font-display mt-1 text-4xl font-extrabold leading-tight sm:text-5xl">
            {filtered.length ? <>{filtered.length} issues picked <span className="text-lime">for you</span>.</> : "Your matches"}
          </h1>
        </div>
        <div className="flex gap-3">
          <div className="card flex items-center gap-4 px-5 py-4">
            <Ring pct={pct} />
            <div>
              <p className="label">This week</p>
              <p className="font-display text-2xl font-extrabold">{stats ? stats.week : "–"}<span className="text-base text-muted">/{goal} PRs</span></p>
            </div>
          </div>
          <div className="card flex items-center gap-3 px-5 py-4">
            <Flame className={`h-8 w-8 ${stats?.streak ? "text-orange" : "text-muted"}`} />
            <div>
              <p className="label">Streak</p>
              <p className="font-display text-2xl font-extrabold">{stats ? stats.streak : "–"}<span className="text-base text-muted"> days</span></p>
            </div>
          </div>
        </div>
      </section>

      {inProgress.length > 0 && (
        <section className="mt-8">
          <p className="label mb-3">Pick up where you left off</p>
          <div className="grid gap-3 sm:grid-cols-3">
            {inProgress.map(([id, s]) => {
              const [repo, n] = id.split("#");
              return (
                <Link key={id} href={`/app/issue/${repo}/${n}`} className="card group flex items-center gap-3 p-4 transition hover:border-lime/40">
                  <Target className="h-5 w-5 shrink-0 text-lime" />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold">{s.title}</p>
                    <p className="truncate text-xs text-muted">{repo} · {s.stage}</p>
                  </div>
                  <ArrowRight className="ml-auto h-4 w-4 shrink-0 text-muted transition group-hover:translate-x-1 group-hover:text-lime" />
                </Link>
              );
            })}
          </div>
        </section>
      )}

      <section className="mt-10">
        <div className="flex flex-wrap items-center gap-2">
          {["all", ...profile.languages.slice(0, 3)].map((l) => (
            <button key={l} onClick={() => setLang(l)} className={`rounded-full border px-3.5 py-1.5 text-sm font-medium transition ${lang === l ? "border-ink bg-ink text-bg" : "border-line text-muted hover:text-ink"}`}>
              {l === "all" ? "All languages" : l}
            </button>
          ))}
          <span className="mx-1 h-5 w-px bg-line" />
          {["all", "Easy", "Medium", "Spicy"].map((d) => (
            <button key={d} onClick={() => setDiff(d)} className={`rounded-full border px-3.5 py-1.5 text-sm font-medium transition ${diff === d ? "border-ink bg-ink text-bg" : "border-line text-muted hover:text-ink"}`}>
              {d === "all" ? "Any vibe" : d}
            </button>
          ))}
          <button onClick={load} className="btn-quiet ml-auto" disabled={loading}>
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Refresh
          </button>
        </div>

        {error && <div className="mt-6"><ErrorBox error={error} onRetry={load} /></div>}
        {loading && !matches && (
          <div className="mt-6">
            <Loader lines={["Scanning good first issues…", "Checking maintainers are alive…", "Ranking by your stack…"]} />
            <div className="mt-4 grid gap-4 md:grid-cols-2">{[0, 1, 2, 3].map((i) => <div key={i} className="skeleton h-48" />)}</div>
          </div>
        )}
        {matches && !filtered.length && !loading && (
          <div className="card mt-6 p-10 text-center text-muted">Nothing for this filter right now. Try another language or vibe.</div>
        )}
        <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2">
          {filtered.map((m, i) => (
            <article key={m.id} className="card animate-rise flex min-w-0 flex-col p-5 transition hover:border-muted/40" style={{ animationDelay: `${Math.min(i, 8) * 50}ms` }}>
              <div className="flex items-center gap-2 text-xs text-muted">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={m.repoInfo.avatar} alt="" className="h-5 w-5 rounded-md" />
                <span className="truncate font-medium text-ink/80">{m.owner}/{m.repo}</span>
                <span className="inline-flex items-center gap-0.5"><Star className="h-3 w-3" /> {compact(m.repoInfo.stars)}</span>
                <span className="ml-auto rounded-full bg-lime/10 px-2 py-0.5 font-mono font-semibold text-lime">{m.score}%</span>
              </div>
              <h3 className="font-display mt-3 line-clamp-2 break-words text-xl font-bold leading-snug">{m.title}</h3>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <DifficultyPill d={m.difficulty} />
                <span className="chip text-[11px]">{m.language}</span>
                <span className="chip text-[11px]"><Clock className="h-3 w-3" /> ~{m.minutes} min</span>
                <span className="chip text-[11px]"><MessageCircle className="h-3 w-3" /> {m.comments}</span>
              </div>
              <ul className="mt-4 space-y-1 text-xs text-muted">
                {m.reasons.map((r) => <li key={r}>✓ {r}</li>)}
              </ul>
              <div className="mt-5 flex items-center gap-2 pt-1 sm:mt-auto">
                <span className="text-[11px] text-muted">opened {timeAgo(m.createdAt)}</span>
                <a href={m.url} target="_blank" rel="noreferrer" className="btn-quiet ml-auto px-2" aria-label="Open on GitHub"><ExternalLink className="h-4 w-4" /></a>
                <button onClick={() => start(m)} className="btn-lime py-2">
                  <Sparkles className="h-4 w-4" /> Start
                </button>
              </div>
            </article>
          ))}
        </div>
      </section>
      {paywall && <Paywall onClose={() => setPaywall(null)} onContinue={() => router.push(`/app/issue/${paywall.owner}/${paywall.repo}/${paywall.number}`)} />}
    </main>
  );
}

function Ring({ pct }: { pct: number }) {
  const r = 18;
  const c = 2 * Math.PI * r;
  return (
    <svg width="48" height="48" viewBox="0 0 48 48" className="-rotate-90">
      <circle cx="24" cy="24" r={r} fill="none" stroke="var(--surface-3)" strokeWidth="6" />
      <circle cx="24" cy="24" r={r} fill="none" stroke="var(--lime)" strokeWidth="6" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - pct)} className="transition-all duration-700" />
    </svg>
  );
}
