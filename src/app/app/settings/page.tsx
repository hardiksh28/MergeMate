"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, ExternalLink, KeyRound, LogOut } from "lucide-react";
import { api, signInHref, signOut, useLocal, useSession, type Keys, type Profile } from "@/lib/client";
import { GithubIcon } from "@/components/ui";

export default function Settings() {
  const [keys, setKeys] = useLocal<Keys>("keys", { groq: "", github: "" });
  const [profile, setProfile] = useLocal<Profile | null>("profile", null);
  const [status, setStatus] = useState<{ groqServer: boolean; githubServer: boolean; model: string } | null>(null);
  const [groq, setGroq] = useState("");
  const [github, setGithub] = useState("");
  const [saved, setSaved] = useState(false);
  const [ghUser, setGhUser] = useState<string | null>(null);
  const router = useRouter();
  const session = useSession();

  useEffect(() => {
    api<typeof status>("/api/status").then(setStatus).catch(() => {});
  }, []);
  useEffect(() => {
    setGroq(keys.groq);
    setGithub(keys.github);
  }, [keys.groq, keys.github]);
  useEffect(() => {
    if (!keys.github) return setGhUser(null);
    fetch("https://api.github.com/user", { headers: { Authorization: `Bearer ${keys.github}` } })
      .then((r) => (r.ok ? r.json() : null))
      .then((u) => setGhUser(u?.login || null))
      .catch(() => setGhUser(null));
  }, [keys.github]);

  function save() {
    setKeys({ groq: groq.trim(), github: github.trim() });
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  }

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-8">
      <h1 className="font-display text-4xl font-extrabold sm:text-5xl">Settings</h1>

      <section className="card mt-8 p-6">
        <div className="flex items-center gap-2"><GithubIcon size={18} /><h2 className="font-display text-xl font-bold">GitHub account</h2></div>
        {!session.ready ? (
          <div className="skeleton mt-4 h-14" />
        ) : session.user ? (
          <div className="mt-4 flex items-center gap-3 rounded-2xl bg-surface-2 p-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={session.user.avatar} alt="" className="h-10 w-10 rounded-xl" />
            <div className="min-w-0 flex-1">
              <p className="truncate font-semibold">{session.user.name || session.user.login}</p>
              <p className="truncate text-xs text-muted">Signed in as @{session.user.login} · PRs open from this account</p>
            </div>
            <span className="chip border-lime/40 text-lime"><Check className="h-3 w-3" /> connected</span>
          </div>
        ) : session.configured ? (
          <div className="mt-4">
            <p className="text-sm text-muted">Sign in to open PRs from your account in one click and to track your MergeMate streak.</p>
            <a href={signInHref("/app/settings")} className="btn-lime mt-4"><GithubIcon /> Sign in with GitHub</a>
          </div>
        ) : (
          <p className="mt-3 text-sm text-orange">GitHub sign-in isn&apos;t configured on this server yet (add GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET and SESSION_SECRET to .env.local). Use a personal token below meanwhile.</p>
        )}
      </section>

      <details className="card mt-4 p-6 [&_summary::-webkit-details-marker]:hidden" open={session.ready && !session.configured}>
        <summary className="flex cursor-pointer list-none items-center gap-2"><KeyRound className="h-[18px] w-[18px]" /><h2 className="font-display text-xl font-bold">Personal token <span className="text-sm font-medium text-muted">(advanced)</span></h2>
          {ghUser && <span className="chip ml-auto border-lime/40 text-lime"><Check className="h-3 w-3" /> @{ghUser}</span>}
        </summary>
        <p className="mt-2 text-sm text-muted">
          Only if you can&apos;t use GitHub sign-in. Used when you press submit; a signed-in account takes priority.
        </p>
        <ol className="mt-4 space-y-1 text-sm text-ink/80">
          <li>1. Create a <a className="text-lime underline-offset-4 hover:underline" href="https://github.com/settings/tokens/new?scopes=public_repo&description=MergeMate" target="_blank" rel="noreferrer">classic token with <code className="inline">public_repo</code> <ExternalLink className="inline h-3 w-3" /></a></li>
          <li>2. Paste it below. It stays in this browser only.</li>
        </ol>
        <input className="input mt-4 font-mono" type="password" placeholder="ghp_…" value={github} onChange={(e) => setGithub(e.target.value)} autoComplete="off" />
      </details>

      <section className="card mt-4 p-6">
        <div className="flex items-center gap-2"><KeyRound className="h-[18px] w-[18px]" /><h2 className="font-display text-xl font-bold">AI key (Groq)</h2>
          {status?.groqServer && <span className="chip ml-auto border-lime/40 text-lime"><Check className="h-3 w-3" /> server key set</span>}
        </div>
        <p className="mt-2 text-sm text-muted">
          {status?.groqServer
            ? `The server already has GROQ_API_KEY, so you're good. Model: ${status.model}.`
            : <>No server key found. Grab a free one at <a className="text-lime underline-offset-4 hover:underline" href="https://console.groq.com/keys" target="_blank" rel="noreferrer">console.groq.com/keys</a> and paste it here (or set <code className="inline">GROQ_API_KEY</code> in <code className="inline">.env.local</code>).</>}
        </p>
        <input className="input mt-4 font-mono" type="password" placeholder="gsk_…" value={groq} onChange={(e) => setGroq(e.target.value)} autoComplete="off" />
        {status && !status.githubServer && (
          <p className="mt-3 text-xs text-orange">Tip: set <code className="inline">GITHUB_TOKEN</code> in .env.local on the server too. Without it GitHub only allows 60 requests/hour.</p>
        )}
      </section>

      <button className="btn-lime mt-4" onClick={save}>{saved ? <><Check className="h-4 w-4" /> Saved</> : "Save keys"}</button>

      {profile && (
        <section className="card mt-10 p-6">
          <h2 className="font-display text-xl font-bold">Matching</h2>
          <p className="label mt-5">Difficulty</p>
          <div className="mt-2 flex gap-2">
            {(["beginner", "intermediate"] as const).map((l) => (
              <button key={l} onClick={() => setProfile({ ...profile, level: l })} className={`rounded-full border px-4 py-1.5 text-sm font-medium ${profile.level === l ? "border-lime bg-lime text-lime-ink" : "border-line text-muted"}`}>
                {l === "beginner" ? "🌱 Good first issues" : "⚡ Help wanted"}
              </button>
            ))}
          </div>
          <p className="label mt-5">Weekly goal</p>
          <div className="mt-2 flex gap-2">
            {[1, 2, 3, 5].map((n) => (
              <button key={n} onClick={() => setProfile({ ...profile, weeklyGoal: n })} className={`h-10 w-12 rounded-xl border font-bold ${profile.weeklyGoal === n ? "border-lime bg-lime text-lime-ink" : "border-line"}`}>{n}</button>
            ))}
          </div>
          <p className="label mt-5">Languages</p>
          <p className="mt-2 text-sm text-ink/80">{profile.languages.join(", ")} · <a href={`/onboarding?u=${profile.username}`} className="text-lime">redo onboarding</a></p>
          <button
            className="btn-ghost mt-8 text-red"
            onClick={async () => {
              await signOut();
              setProfile(null);
              router.push("/");
            }}
          >
            <LogOut className="h-4 w-4" /> Sign out
          </button>
        </section>
      )}
    </main>
  );
}
