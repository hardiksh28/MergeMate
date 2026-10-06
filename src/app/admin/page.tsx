"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Activity, Building2, Download, GitPullRequest, RefreshCw, Search, Target, UserPlus, Users } from "lucide-react";
import { Logo } from "@/components/Logo";
import { GithubIcon } from "@/components/ui";
import { compact, signInHref, timeAgo } from "@/lib/client";
import type { AdminStats } from "@/app/api/admin/route";

type City = { total: number; founders: number; latest: { handle: string; github: string | null; tier: string; place: number; joinedAt: string }[] };
type State =
  | { kind: "loading" }
  | { kind: "signin" }
  | { kind: "forbidden"; login: string }
  | { kind: "nodb" }
  | { kind: "error"; detail: string }
  | { kind: "ok"; stats: AdminStats; city: City; at: number };

const KIND_LABEL: Record<string, string> = {
  signin: "signed in",
  onboard: "finished onboarding",
  match: "tried “find my issues”",
  start: "started an issue",
  guess: "checked a guess",
  fix: "prepped a fix",
  check: "ran the contribution check",
  pr: "opened a PR 🎉",
  prep: "did interview prep",
  reply: "drafted a review reply",
};

export default function Admin() {
  const [state, setState] = useState<State>({ kind: "loading" });
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setBusy(true);
    try {
      const res = await fetch("/api/admin", { cache: "no-store" });
      const d = await res.json();
      if (res.ok) setState({ kind: "ok", stats: d.stats, city: d.city, at: Date.now() });
      else if (d.error === "signin") setState({ kind: "signin" });
      else if (d.error === "forbidden") setState({ kind: "forbidden", login: d.login });
      else if (d.error === "nodb") setState({ kind: "nodb" });
      else setState({ kind: "error", detail: d.detail || d.error || `HTTP ${res.status}` });
    } catch (e) {
      setState({ kind: "error", detail: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-40 border-b border-line/60 bg-bg/80 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-3 px-4 sm:px-6">
          <Logo href="/" size={24} />
          <span className="chip border-orange/40 text-orange">admin</span>
          <div className="ml-auto flex items-center gap-2">
            {state.kind === "ok" && (
              <>
                <span className="hidden text-xs text-muted sm:inline">updated {timeAgo(new Date(state.at).toISOString())}</span>
                <button className="btn-ghost py-1.5 text-xs" onClick={() => exportCsv(state.stats.people)}>
                  <Download className="h-3.5 w-3.5" /> CSV
                </button>
              </>
            )}
            <button className="btn-ghost py-1.5 text-xs" onClick={load} disabled={busy}>
              <RefreshCw className={`h-3.5 w-3.5 ${busy ? "animate-spin" : ""}`} /> Refresh
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
        {state.kind === "loading" && (
          <div className="grid gap-3 sm:grid-cols-4">{Array.from({ length: 8 }, (_, i) => <div key={i} className="skeleton h-28" />)}</div>
        )}
        {state.kind === "signin" && (
          <Gate title="Admins only." text="Sign in with the GitHub account that runs MergeMate.">
            <a href={signInHref("/admin")} className="btn-lime mt-6"><GithubIcon /> Sign in with GitHub</a>
          </Gate>
        )}
        {state.kind === "forbidden" && (
          <Gate title="Not an admin." text={`@${state.login} isn't on the admin list. Add it to ADMIN_GITHUB_LOGINS in Vercel to grant access.`}>
            <Link href="/app" className="btn-ghost mt-6">Back to the app</Link>
          </Gate>
        )}
        {state.kind === "nodb" && <Setup />}
        {state.kind === "error" && (
          <Gate title="Couldn't load stats." text={state.detail}>
            <p className="mt-3 text-sm text-muted">If it mentions a missing function, run <code className="inline">supabase/mergemate.sql</code> in the Supabase SQL editor.</p>
          </Gate>
        )}
        {state.kind === "ok" && <Dashboard stats={state.stats} city={state.city} />}
      </main>
    </div>
  );
}

function Dashboard({ stats, city }: { stats: AdminStats; city: City }) {
  const [q, setQ] = useState("");
  const people = useMemo(
    () => stats.people.filter((p) => !q || `${p.login} ${p.name || ""}`.toLowerCase().includes(q.toLowerCase())),
    [stats.people, q],
  );
  const k = stats.by_kind || {};
  const kpis = [
    { icon: Users, c: "text-lime", label: "Accounts", value: stats.users, sub: `+${stats.new_today} today · +${stats.new_7d} this week` },
    { icon: Activity, c: "text-sky", label: "Active users", value: stats.active_7d, sub: `${stats.active_today} today · last 7 days` },
    { icon: Target, c: "text-violet", label: "Issues started", value: k.start || 0, sub: `${k.fix || 0} fixes prepped` },
    { icon: GitPullRequest, c: "text-pink", label: "PRs opened", value: k.pr || 0, sub: "through MergeMate" },
    { icon: Search, c: "text-orange", label: "Landing lookups", value: k.match || 0, sub: "“find my issues” tries" },
    { icon: UserPlus, c: "text-lime", label: "Onboarded", value: stats.funnel.onboarded, sub: "finished setup" },
    { icon: Building2, c: "text-sky", label: "MergeCity", value: city.total, sub: `${city.founders} founder${city.founders === 1 ? "" : "s"} · waitlist` },
    { icon: Activity, c: "text-violet", label: "AI actions", value: (k.guess || 0) + (k.fix || 0) + (k.check || 0) + (k.prep || 0) + (k.reply || 0), sub: "guesses, fixes, checks, prep" },
  ];

  return (
    <div className="space-y-6">
      <h1 className="font-display text-4xl font-extrabold">How MergeMate is doing</h1>

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {kpis.map((x) => (
          <div key={x.label} className="card p-5">
            <x.icon className={`h-5 w-5 ${x.c}`} />
            <p className="font-display mt-3 text-4xl font-extrabold">{compact(x.value)}</p>
            <p className="text-sm font-medium">{x.label}</p>
            <p className="mt-0.5 text-xs text-muted">{x.sub}</p>
          </div>
        ))}
      </section>

      <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        <section className="card p-6">
          <div className="flex flex-wrap items-center gap-4">
            <p className="label">Last 30 days</p>
            <span className="flex items-center gap-1.5 text-xs text-muted"><span className="h-2.5 w-2.5 rounded-sm bg-lime" /> active users</span>
            <span className="flex items-center gap-1.5 text-xs text-muted"><span className="h-2.5 w-2.5 rounded-sm bg-violet" /> new accounts</span>
          </div>
          <Daily days={stats.daily || []} />
        </section>

        <section className="card p-6">
          <p className="label">Funnel</p>
          <Funnel f={stats.funnel} />
        </section>
      </div>

      <section className="card p-6">
        <div className="flex flex-wrap items-center gap-3">
          <p className="label">People ({stats.people.length})</p>
          <input className="input ml-auto max-w-xs py-2" placeholder="Search login or name" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        {stats.people.length === 0 ? (
          <p className="mt-6 text-sm text-muted">No accounts yet. They appear here the first time someone signs in with GitHub.</p>
        ) : (
          <div className="scroll-thin mt-4 overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr className="text-left text-xs text-muted">
                  {["User", "Joined", "Last seen", "Sign-ins", "Issues", "PRs", "Actions"].map((h) => (
                    <th key={h} className="border-b border-line px-2 py-2 font-medium">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {people.map((p) => (
                  <tr key={p.login} className="border-b border-line/50 hover:bg-surface-2/60">
                    <td className="px-2 py-2.5">
                      <Link href={`/u/${p.login}`} className="flex items-center gap-2.5 hover:text-lime">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={p.avatar} alt="" className="h-7 w-7 rounded-lg" />
                        <span>
                          <span className="font-medium">@{p.login}</span>
                          {p.name && <span className="block text-xs text-muted">{p.name}</span>}
                        </span>
                      </Link>
                    </td>
                    <td className="px-2 text-muted">{new Date(p.created_at).toLocaleDateString()}</td>
                    <td className="px-2 text-muted">{timeAgo(p.last_seen)}</td>
                    <td className="px-2">{p.sign_ins}</td>
                    <td className="px-2">{p.starts}</td>
                    <td className={`px-2 ${p.prs ? "font-semibold text-lime" : ""}`}>{p.prs}</td>
                    <td className="px-2">{p.actions}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        <section className="card p-6">
          <p className="label">Live feed</p>
          {stats.recent.length === 0 ? (
            <p className="mt-4 text-sm text-muted">Nothing yet.</p>
          ) : (
            <ul className="mt-4 space-y-2">
              {stats.recent.map((e, i) => (
                <li key={i} className="flex items-baseline gap-2 text-sm">
                  <span className="w-16 shrink-0 text-xs text-muted">{timeAgo(e.created_at)}</span>
                  <span>
                    <span className="font-medium">{e.login ? `@${e.login}` : "A visitor"}</span>{" "}
                    <span className="text-ink/80">{KIND_LABEL[e.kind] || e.kind}</span>
                    {e.meta && <Meta meta={e.meta} />}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className="card p-6">
          <p className="label">Newest in MergeCity</p>
          <ul className="mt-4 space-y-2 text-sm">
            {city.latest.map((r) => (
              <li key={r.place} className="flex items-center gap-2">
                <span className="text-muted">#{r.place}</span>
                <span className="font-medium">{r.handle}</span>
                {r.github && <span className="text-xs text-muted">@{r.github}</span>}
                {r.tier === "founder" && <span className="chip border-orange/40 text-[10px] text-orange">founder</span>}
                <span className="ml-auto text-xs text-muted">{timeAgo(r.joinedAt)}</span>
              </li>
            ))}
            {!city.latest.length && <li className="text-muted">No residents yet.</li>}
          </ul>
          <a href="https://merge-city.vercel.app/admin" target="_blank" rel="noreferrer" className="btn-ghost mt-5 w-full py-2 text-xs">MergeCity admin ↗</a>
        </section>
      </div>
    </div>
  );
}

function Meta({ meta }: { meta: Record<string, unknown> }) {
  if (typeof meta.url === "string") return <> · <a href={meta.url} target="_blank" rel="noreferrer" className="text-lime hover:underline">view PR</a></>;
  if (typeof meta.issue === "string") return <span className="text-muted"> · {meta.issue}</span>;
  if (typeof meta.username === "string") return <span className="text-muted"> · as @{meta.username}</span>;
  return null;
}

function Daily({ days }: { days: AdminStats["daily"] }) {
  const max = Math.max(1, ...days.map((d) => Math.max(d.active, d.signups)));
  return (
    <div className="mt-5">
      <div className="flex h-40 items-end gap-1">
        {days.map((d) => (
          <div key={d.day} className="group relative flex h-full flex-1 items-end gap-px" title={`${d.day}: ${d.active} active, ${d.signups} new, ${d.prs} PRs, ${d.lookups} lookups`}>
            <div className="w-1/2 rounded-t-sm bg-lime/80 transition group-hover:bg-lime" style={{ height: `${(d.active / max) * 100}%`, minHeight: d.active ? 3 : 0 }} />
            <div className="w-1/2 rounded-t-sm bg-violet/80 transition group-hover:bg-violet" style={{ height: `${(d.signups / max) * 100}%`, minHeight: d.signups ? 3 : 0 }} />
          </div>
        ))}
      </div>
      <div className="mt-2 flex justify-between text-[10px] text-muted">
        <span>{days[0]?.day.slice(5)}</span>
        <span>today</span>
      </div>
    </div>
  );
}

function Funnel({ f }: { f: AdminStats["funnel"] }) {
  const steps = [
    ["Signed in", f.signed_in],
    ["Finished onboarding", f.onboarded],
    ["Started an issue", f.started],
    ["Prepped a fix", f.fixed],
    ["Opened a PR", f.pr],
  ] as const;
  const top = Math.max(1, steps[0][1]);
  return (
    <ul className="mt-5 space-y-3">
      {steps.map(([label, n], i) => (
        <li key={label}>
          <div className="flex items-baseline justify-between text-sm">
            <span>{label}</span>
            <span className="font-semibold">
              {n}
              {i > 0 && <span className="ml-1.5 text-xs font-normal text-muted">{Math.round((n / top) * 100)}%</span>}
            </span>
          </div>
          <div className="mt-1 h-2 overflow-hidden rounded-full bg-surface-3">
            <div className="h-full rounded-full bg-lime" style={{ width: `${(n / top) * 100}%` }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

function Gate({ title, text, children }: { title: string; text: string; children?: React.ReactNode }) {
  return (
    <div className="card mx-auto mt-10 max-w-lg p-8 text-center">
      <h1 className="font-display text-3xl font-extrabold">{title}</h1>
      <p className="mt-2 text-muted">{text}</p>
      {children}
    </div>
  );
}

function Setup() {
  return (
    <div className="card mx-auto mt-6 max-w-2xl p-8">
      <h1 className="font-display text-3xl font-extrabold">Connect the database</h1>
      <p className="mt-2 text-muted">The dashboard needs MergeMate&apos;s tables in Supabase. One-time setup, about 3 minutes:</p>
      <ol className="mt-5 list-decimal space-y-3 pl-5 text-sm text-ink/85">
        <li>Supabase → your MergeCity project → <b>SQL Editor → New query</b>. Paste <code className="inline">supabase/mergemate.sql</code> from the repo and click <b>Run</b>.</li>
        <li>Supabase → <b>Project Settings → API keys</b> → copy the <b>service_role</b> (secret) key.</li>
        <li>Vercel → mergemate → <b>Settings → Environment Variables</b>: add <code className="inline">MERGEMATE_SUPABASE_SERVICE_KEY</code> (Sensitive) with that key.</li>
        <li>Vercel → <b>Deployments → ⋯ → Redeploy</b>, then refresh this page.</li>
      </ol>
    </div>
  );
}

function exportCsv(people: AdminStats["people"]) {
  const head = ["login", "name", "joined", "last_seen", "sign_ins", "issues_started", "prs", "actions"];
  const rows = people.map((p) => [p.login, p.name || "", p.created_at, p.last_seen, p.sign_ins, p.starts, p.prs, p.actions]);
  const csv = [head, ...rows].map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  a.download = `mergemate-users-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}
