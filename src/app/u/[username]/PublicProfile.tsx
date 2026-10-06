"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Check, Copy, ExternalLink, Flame, GitMerge, GitPullRequest, Share2, Sparkles, Star, Trophy } from "lucide-react";
import { LogoMark } from "@/components/Logo";
import { api, compact, timeAgo } from "@/lib/client";
import { Logo } from "@/components/Logo";
import { ContribGraph, ErrorBox, GithubIcon } from "@/components/ui";
import { ResidentBadge, cityHref } from "@/components/CityCard";

type Data = {
  user: { login: string; name: string | null; avatar: string; bio: string | null; followers: number; since: string; url: string };
  days: { date: string; count: number; level: number }[];
  stats: { current: number; longest: number; total: number; last30: number; merged: number; open: number; repos: number; stars: number };
  prs: { id: string; repo: string; number: number; title: string; url: string; mergedAt: string | null; stars: number; language: string | null; avatar: string | null; summary: string }[];
  provenSkills: { name: string; count: number }[];
  mergemate: { days: { date: string; count: number; level: number }[]; current: number; longest: number; activeDays: number; actions: number; prs: number; last30: number };
  languages: string[];
};

const LANG_COLORS = ["bg-lime", "bg-sky", "bg-violet", "bg-pink", "bg-orange"];

export function PublicProfile({ username }: { username: string }) {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    api<Data>(`/api/public/${encodeURIComponent(username)}`).then(setData).catch((e) => setError(e.message));
  }, [username]);

  const share = () => {
    navigator.clipboard.writeText(location.href);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="relative min-h-screen">
      <div className="glow-lime pointer-events-none absolute left-1/2 top-0 h-[420px] w-[800px] -translate-x-1/2" />
      <header className="relative mx-auto flex max-w-5xl items-center justify-between px-4 py-5 sm:px-6">
        <Logo size={26} />
        <div className="flex gap-2">
          <a href={cityHref()} target="_blank" rel="noreferrer" className="btn-quiet hidden py-2 text-xs sm:inline-flex">MergeCity</a>
          <button onClick={share} className="btn-ghost py-2 text-xs">{copied ? <Check className="h-3.5 w-3.5" /> : <Share2 className="h-3.5 w-3.5" />} {copied ? "Copied" : "Share"}</button>
          <Link href="/onboarding" className="btn-lime hidden py-2 text-xs sm:inline-flex">Get your own</Link>
        </div>
      </header>

      <main className="relative mx-auto max-w-5xl px-4 pb-24 sm:px-6">
        {error && <ErrorBox error={error} />}
        {!data && !error && (
          <div className="space-y-4 pt-6">
            <div className="skeleton h-32" />
            <div className="skeleton h-40" />
            <div className="skeleton h-64" />
          </div>
        )}
        {data && (
          <>
            <section className="flex flex-col gap-6 pt-6 sm:flex-row sm:items-end">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={data.user.avatar} alt="" className="h-28 w-28 rounded-[2rem] border-4 border-surface-3" />
              <div className="flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="font-display text-4xl font-extrabold leading-none sm:text-5xl">{data.user.name || data.user.login}</h1>
                  {data.stats.merged > 0 && <span className="sticker rotate-[-3deg] bg-lime">✓ {data.stats.merged} merged</span>}
                </div>
                <p className="mt-2 text-muted">
                  <a href={data.user.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:text-ink"><GithubIcon size={14} /> @{data.user.login}</a>
                  {data.user.bio && <> · {data.user.bio}</>}
                </p>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  <ResidentBadge username={data.user.login} />
                  {data.languages.map((l) => <span key={l} className="chip">{l}</span>)}
                </div>
              </div>
            </section>

            <section className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[
                { n: data.stats.merged, l: "merged PRs", i: GitMerge, c: "text-violet" },
                { n: data.stats.repos, l: "projects contributed to", i: Trophy, c: "text-orange" },
                { n: data.stats.current, l: "day streak", i: Flame, c: "text-pink", sub: `best ${data.stats.longest}` },
                { n: data.stats.total, l: "contributions this year", i: Star, c: "text-lime" },
              ].map((s) => (
                <div key={s.l} className="card p-5">
                  <s.i className={`h-5 w-5 ${s.c}`} />
                  <p className="font-display mt-3 text-4xl font-extrabold">{compact(s.n)}</p>
                  <p className="text-xs text-muted">{s.l}{s.sub && <> · {s.sub}</>}</p>
                </div>
              ))}
            </section>

            <section className="card mt-4 p-6">
              <div className="mb-4 flex items-center justify-between">
                <p className="label">GitHub activity, live</p>
                <p className="text-xs text-muted">{data.stats.last30} in the last 30 days</p>
              </div>
              <ContribGraph days={data.days} cell={12} />
            </section>

            <MergeMateActivity m={data.mergemate} />

            <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_300px]">
              <section className="card p-6">
                <p className="label">Merged pull requests</p>
                {!data.prs.length && <p className="mt-6 text-sm text-muted">No merged PRs to other projects yet. The first one is loading… 🌱</p>}
                <div className="mt-4 space-y-3">
                  {data.prs.map((p) => (
                    <a key={p.id} href={p.url} target="_blank" rel="noreferrer" className="group flex gap-4 rounded-2xl border border-transparent bg-surface-2 p-4 transition hover:border-violet/40">
                      {p.avatar ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={p.avatar} alt="" className="h-10 w-10 shrink-0 rounded-xl" />
                      ) : (
                        <GitMerge className="h-10 w-10 shrink-0 text-violet" />
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="flex items-center gap-2 text-xs text-muted">
                          <span className="truncate font-medium text-ink/80">{p.repo}</span>
                          {p.stars > 0 && <span className="inline-flex items-center gap-0.5"><Star className="h-3 w-3" /> {compact(p.stars)}</span>}
                          {p.mergedAt && <span>· {timeAgo(p.mergedAt)}</span>}
                        </p>
                        <p className="mt-1 font-semibold leading-snug">{p.summary || p.title}</p>
                        {p.summary && <p className="mt-0.5 truncate font-mono text-[11px] text-muted">{p.title}</p>}
                      </div>
                      <ExternalLink className="h-4 w-4 shrink-0 text-muted opacity-0 transition group-hover:opacity-100" />
                    </a>
                  ))}
                </div>
              </section>

              <aside className="space-y-4">
                <section className="card p-6">
                  <p className="label">Proven skills</p>
                  <p className="mt-1 text-xs text-muted">Backed by merged code, not keywords.</p>
                  {data.provenSkills.length ? (
                    <>
                      <div className="mt-4 flex h-3 overflow-hidden rounded-full">
                        {data.provenSkills.map((s, i) => <span key={s.name} className={LANG_COLORS[i % 5]} style={{ flex: s.count }} />)}
                      </div>
                      <ul className="mt-4 space-y-2 text-sm">
                        {data.provenSkills.map((s, i) => (
                          <li key={s.name} className="flex items-center gap-2">
                            <span className={`h-2.5 w-2.5 rounded-full ${LANG_COLORS[i % 5]}`} />
                            {s.name}
                            <span className="ml-auto text-xs text-muted">{s.count} PR{s.count > 1 ? "s" : ""}</span>
                          </li>
                        ))}
                      </ul>
                    </>
                  ) : (
                    <p className="mt-4 text-sm text-muted">Appears after the first merge.</p>
                  )}
                </section>
                <section className="card p-6">
                  <p className="label">On GitHub since</p>
                  <p className="font-display mt-2 text-2xl font-bold">{new Date(data.user.since).getFullYear()}</p>
                  <p className="mt-4 label">Open PRs right now</p>
                  <p className="font-display mt-2 text-2xl font-bold">{data.stats.open}</p>
                </section>
                <button onClick={share} className="btn-ghost w-full">{copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />} Copy profile link</button>
              </aside>
            </div>

            <p className="mt-10 text-center text-xs text-muted">
              Verified from public GitHub data · <Link href="/" className="text-lime">Built with MergeMate</Link>
            </p>
          </>
        )}
      </main>
    </div>
  );
}

/** Consistency on MergeMate itself: days spent learning a codebase, finding bugs and shipping PRs. */
function MergeMateActivity({ m }: { m: Data["mergemate"] }) {
  const empty = m.activeDays === 0;
  return (
    <section className="card mt-4 p-6">
      <div className="mb-4 flex flex-wrap items-center gap-x-6 gap-y-3">
        <div className="flex items-center gap-2">
          <LogoMark size={18} />
          <p className="label">MergeMate activity</p>
        </div>
        {!empty && (
          <div className="flex flex-wrap items-center gap-2 text-xs sm:ml-auto">
            <span className={`chip ${m.current ? "border-orange/40 text-orange" : ""}`}>
              <Flame className="h-3.5 w-3.5" /> {m.current}-day streak
            </span>
            <span className="chip"><Sparkles className="h-3.5 w-3.5 text-violet" /> {m.activeDays} active days</span>
            <span className="chip"><GitPullRequest className="h-3.5 w-3.5 text-lime" /> {m.prs} PR{m.prs === 1 ? "" : "s"} via MergeMate</span>
            <span className="text-muted">best streak {m.longest}d</span>
          </div>
        )}
      </div>
      <ContribGraph days={m.days} cell={12} tone="violet" unit="MergeMate points" />
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted">
        <p>
          {empty
            ? "No MergeMate sessions yet. Squares light up when you explore an issue, find a bug, prep a fix or ship a PR."
            : "Each square: issues explored, bugs found, fixes prepped and PRs shipped that day."}
        </p>
        <div className="flex items-center gap-1">
          less
          {["bg-surface-3", "bg-violet/25", "bg-violet/50", "bg-violet/75", "bg-violet"].map((c) => (
            <span key={c} className={`h-2.5 w-2.5 rounded-[3px] ${c}`} />
          ))}
          more
        </div>
      </div>
    </section>
  );
}
