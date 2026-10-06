"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, Check, Lock, Sparkles, Star } from "lucide-react";
import { api, compact } from "@/lib/client";
import type { Match } from "@/app/api/match/route";
import { DifficultyPill, ErrorBox, GithubIcon, Loader } from "./ui";
import { MERGECITY_URL, cityUrl } from "@/lib/city-link";

export function TryIt() {
  const [username, setUsername] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [data, setData] = useState<{ langs: string[]; matches: Match[] } | null>(null);

  async function go(e?: React.FormEvent) {
    e?.preventDefault();
    if (!username.trim()) return;
    setLoading(true);
    setError("");
    setData(null);
    try {
      setData(await api(`/api/match?username=${encodeURIComponent(username.trim().replace(/^@/, ""))}&limit=3`));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="w-full max-w-xl">
      <form onSubmit={go} className="flex flex-col gap-2 rounded-[28px] border border-line bg-surface/80 p-2 backdrop-blur sm:flex-row">
        <label className="flex flex-1 items-center gap-2 px-3">
          <GithubIcon className="shrink-0 text-muted" />
          <span className="text-sm text-muted">github.com/</span>
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="your-username"
            className="min-w-0 flex-1 bg-transparent py-3 text-sm outline-none placeholder:text-muted/60"
            autoComplete="off"
            spellCheck={false}
            aria-label="GitHub username"
          />
        </label>
        <button className="btn-lime py-3" disabled={loading}>
          Find my issues <ArrowRight className="h-4 w-4" />
        </button>
      </form>
      <p className="mt-3 px-2 text-xs text-muted">No signup. We read your public repos and match you live.</p>

      {loading && (
        <div className="mt-6 space-y-3">
          <Loader lines={["Reading your repos…", "Sniffing out active maintainers…", "Skipping abandoned repos…"]} />
          {[0, 1, 2].map((i) => (
            <div key={i} className="skeleton h-24" />
          ))}
        </div>
      )}
      {error && <div className="mt-6"><ErrorBox error={error} onRetry={go} /></div>}
      {data && (
        <div className="mt-6 space-y-3 text-left">
          <p className="text-sm text-muted">
            Matched on <span className="text-ink">{data.langs.join(", ")}</span>. {data.matches.length ? "Your top picks:" : "No fresh matches right now, try again later."}
          </p>
          {data.matches.map((m, i) => (
            <MiniMatch key={m.id} m={m} i={i} />
          ))}
          {data.matches.length > 0 && (
            <Link href={`/onboarding?u=${encodeURIComponent(username.trim())}`} className="btn-lime w-full py-3">
              Start one for free <Sparkles className="h-4 w-4" />
            </Link>
          )}
        </div>
      )}
    </div>
  );
}

function MiniMatch({ m, i }: { m: Match; i: number }) {
  return (
    <a
      href={m.url}
      target="_blank"
      rel="noreferrer"
      className="animate-rise block rounded-2xl border border-line bg-surface p-4 transition hover:border-lime/40"
      style={{ animationDelay: `${i * 90}ms` }}
    >
      <div className="flex items-center gap-2 text-xs text-muted">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={m.repoInfo.avatar} alt="" className="h-4 w-4 rounded" />
        <span className="truncate">{m.owner}/{m.repo}</span>
        <span className="inline-flex items-center gap-0.5"><Star className="h-3 w-3" /> {compact(m.repoInfo.stars)}</span>
        <span className="ml-auto font-mono font-semibold text-lime">{m.score}% match</span>
      </div>
      <p className="mt-1.5 line-clamp-2 font-medium">{m.title}</p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <DifficultyPill d={m.difficulty} />
        {m.reasons.slice(0, 2).map((r) => (
          <span key={r} className="text-[11px] text-muted">· {r}</span>
        ))}
      </div>
    </a>
  );
}

type TierRow = { id: string; name: string; spots: number | null; usd: number; inr: number; perk: string; taken: number; left: number | null };

export function Pricing() {
  const [tiers, setTiers] = useState<TierRow[] | null>(null);
  const [inr, setInr] = useState(false);
  useEffect(() => {
    try {
      setInr(Intl.DateTimeFormat().resolvedOptions().timeZone === "Asia/Calcutta" || Intl.DateTimeFormat().resolvedOptions().timeZone === "Asia/Kolkata");
    } catch {}
    api<{ tiers: TierRow[] }>("/api/waitlist").then((d) => setTiers(d.tiers)).catch(() => {});
  }, []);
  const activeIdx = tiers ? tiers.findIndex((t) => t.left === null || t.left > 0) : 0;

  return (
    <div>
      <div className="mb-8 flex justify-center">
        <div className="inline-flex rounded-full border border-line bg-surface p-1 text-sm">
          {["USD", "INR"].map((c) => (
            <button
              key={c}
              onClick={() => setInr(c === "INR")}
              className={`rounded-full px-4 py-1.5 font-semibold transition ${(c === "INR") === inr ? "bg-ink text-bg" : "text-muted"}`}
            >
              {c === "USD" ? "$ USD" : "₹ INR"}
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-5">
        <div className="card flex flex-col p-6 lg:col-span-1">
          <p className="label">Free</p>
          <p className="font-display mt-3 text-4xl font-extrabold">{inr ? "₹0" : "$0"}</p>
          <p className="mt-1 text-sm text-muted">forever</p>
          <ul className="mt-6 space-y-2 text-sm text-ink/80">
            {["2 guided issues / month", "Codebase explainer", "Public profile"].map((f) => (
              <li key={f} className="flex gap-2"><Check className="mt-0.5 h-4 w-4 shrink-0 text-lime" />{f}</li>
            ))}
          </ul>
          <Link href="/onboarding" className="btn-ghost mt-auto w-full translate-y-0 pt-2.5 lg:mt-8">Start free</Link>
        </div>

        {(tiers || PLACEHOLDER).map((t, i) => {
          const soldOut = t.left === 0;
          const active = i === activeIdx;
          return (
            <div
              key={t.id}
              className={`relative flex flex-col rounded-3xl border p-6 ${
                active ? "border-lime bg-lime/[0.06] shadow-[0_0_60px_-20px_rgba(212,255,58,0.5)]" : "border-line bg-surface"
              } ${soldOut ? "opacity-50" : ""}`}
            >
              {active && <span className="sticker absolute -top-3 left-5 rotate-[-4deg] bg-lime">🔥 Live now</span>}
              <p className="label">{t.name}</p>
              <p className="font-display mt-3 text-4xl font-extrabold">
                {inr ? `₹${t.inr}` : `$${t.usd}`}
                <span className="text-base font-medium text-muted">/mo</span>
              </p>
              <p className="mt-1 text-sm text-muted">{t.perk}</p>
              <div className="mt-6">
                {t.spots ? (
                  <>
                    <div className="h-2 overflow-hidden rounded-full bg-surface-3">
                      <div className="h-full rounded-full bg-lime" style={{ width: `${(t.taken / t.spots) * 100}%` }} />
                    </div>
                    <p className="mt-2 text-xs text-muted">
                      {soldOut ? "Sold out" : <><span className="font-semibold text-ink">{t.left}</span> of {t.spots} spots left</>}
                    </p>
                  </>
                ) : (
                  <p className="text-xs text-muted">Unlimited spots</p>
                )}
              </div>
              <ul className="mt-5 space-y-2 text-sm text-ink/80">
                {["Unlimited guided issues", "CONTRIBUTING.md checker", "Interview prep per PR", "Maintainer reply helper"].map((f) => (
                  <li key={f} className="flex gap-2"><Check className="mt-0.5 h-4 w-4 shrink-0 text-lime" />{f}</li>
                ))}
              </ul>
              {t.spots && (
                <p className="mt-5 inline-flex items-center gap-1.5 text-xs font-semibold text-lime">
                  <Lock className="h-3.5 w-3.5" /> Price locked while subscribed
                </p>
              )}
              <a href={MERGECITY_URL} className={`${active ? "btn-lime" : "btn-ghost"} mt-auto w-full pt-2.5 lg:mt-6`} aria-disabled={soldOut}>
                {soldOut ? "Gone" : active ? "Claim my spot" : "Join waitlist"}
              </a>
            </div>
          );
        })}
      </div>
      <p className="mt-6 text-center text-xs text-muted">
        Spot counters are real: they count live MergeCity residents. No fake scarcity, promise.
      </p>
    </div>
  );
}

const PLACEHOLDER: TierRow[] = [
  { id: "og", name: "OG 100", spots: 100, usd: 8, inr: 299, perk: "3 months free, then locked forever", taken: 0, left: 100 },
  { id: "early", name: "Early 100", spots: 100, usd: 8, inr: 299, perk: "Locked forever", taken: 0, left: 100 },
  { id: "wave", name: "Wave 3", spots: 100, usd: 10, inr: 399, perk: "Locked forever", taken: 0, left: 100 },
  { id: "public", name: "Public", spots: null, usd: 15, inr: 599, perk: "Standard price", taken: 0, left: null },
];

/** The waitlist is MergeCity: one button out, with the live resident count and any referral code passed along. */
export function MergeCityCTA() {
  const [total, setTotal] = useState<number | null>(null);
  const [href, setHref] = useState(MERGECITY_URL);
  useEffect(() => {
    setHref(cityUrl({ ref: new URLSearchParams(location.search).get("ref") }));
    api<{ total: number }>("/api/waitlist").then((d) => setTotal(d.total)).catch(() => {});
  }, []);
  return (
    <div className="mx-auto flex max-w-lg flex-col items-center gap-4 text-center">
      <a href={href} className="btn-lime w-full py-4 text-base">
        Claim my house in MergeCity <ArrowRight className="h-4 w-4" />
      </a>
      <p className="text-sm text-muted">
        {total === null ? "Loading the city…" : (
          <>
            <span className="font-display text-xl font-extrabold text-lime">{total}</span> dev{total === 1 ? "" : "s"} already live there ·{" "}
            {Math.max(0, 100 - total)} of the first 100 spots left
          </>
        )}
      </p>
      <ul className="grid w-full gap-2 text-left text-sm text-ink/80 sm:grid-cols-3">
        {["🏠 A house on your own plot", "🧱 +1 floor per mate you invite", "💡 $2 founder spot on Main Street"].map((t) => (
          <li key={t} className="rounded-2xl border border-line bg-surface-2 px-3 py-2.5">{t}</li>
        ))}
      </ul>
    </div>
  );
}
