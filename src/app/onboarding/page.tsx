"use client";
import { Suspense, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, ArrowRight, Check, FileText, Plus, Upload, X } from "lucide-react";
import { Logo } from "@/components/Logo";
import { ErrorBox, GithubIcon, Loader } from "@/components/ui";
import { api, signInHref, useLocal, useSession, type Profile } from "@/lib/client";

type Analyzed = {
  user: { login: string; name: string | null; avatar: string; bio: string | null; repos: number; followers: number };
  languages: string[];
  skills: string[];
  experienceLevel: string | null;
  headline: string;
  aiError: string | null;
};

export default function OnboardingPage() {
  return (
    <Suspense>
      <Onboarding />
    </Suspense>
  );
}

function Onboarding() {
  const router = useRouter();
  const params = useSearchParams();
  const [, setProfile] = useLocal<Profile | null>("profile", null);
  const [step, setStep] = useState(0);
  const [username, setUsername] = useState(params.get("u") || "");
  const [file, setFile] = useState<File | null>(null);
  const [resumeText, setResumeText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [data, setData] = useState<Analyzed | null>(null);
  const [skills, setSkills] = useState<string[]>([]);
  const [langs, setLangs] = useState<string[]>([]);
  const [level, setLevel] = useState<"beginner" | "intermediate">("beginner");
  const [goal, setGoal] = useState(2);
  const [newSkill, setNewSkill] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const session = useSession();
  const authError = params.get("auth");

  async function analyze(withResume: boolean) {
    setBusy(true);
    setError("");
    try {
      const fd = new FormData();
      fd.set("username", username.trim().replace(/^@/, ""));
      if (withResume && file) fd.set("resume", file);
      if (withResume && resumeText) fd.set("resumeText", resumeText);
      const d = await api<Analyzed>("/api/profile", { method: "POST", body: fd });
      setData(d);
      setSkills(d.skills);
      setLangs(d.languages);
      if (d.experienceLevel && d.experienceLevel !== "beginner") setLevel("intermediate");
      setStep(withResume ? 2 : 1);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (params.get("u")) analyze(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // back from GitHub sign-in: use the verified account
  useEffect(() => {
    if (!session.user || params.get("u") || data || busy) return;
    setUsername(session.user.login);
    const fd = new FormData();
    fd.set("username", session.user.login);
    setBusy(true);
    api<Analyzed>("/api/profile", { method: "POST", body: fd })
      .then((d) => {
        setData(d);
        setSkills(d.skills);
        setLangs(d.languages);
        setStep(1);
      })
      .catch((e) => setError((e as Error).message))
      .finally(() => setBusy(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.user]);

  function finish() {
    if (!data) return;
    setProfile({
      username: data.user.login,
      name: data.user.name,
      avatar: data.user.avatar,
      headline: data.headline,
      languages: langs,
      skills,
      level,
      weeklyGoal: goal,
      createdAt: new Date().toISOString(),
    });
    router.push("/app");
  }

  const steps = ["GitHub", "Resume", "Your stack"];

  return (
    <div className="relative flex min-h-screen flex-col">
      <div className="glow-lime pointer-events-none absolute left-1/2 top-0 h-[400px] w-[700px] -translate-x-1/2" />
      <header className="relative mx-auto flex w-full max-w-5xl items-center justify-between px-4 py-5 sm:px-6">
        <Logo />
        <div className="flex items-center gap-2">
          {steps.map((s, i) => (
            <div key={s} className="flex items-center gap-2">
              <span className={`h-1.5 rounded-full transition-all ${i <= step ? "w-8 bg-lime" : "w-4 bg-surface-3"}`} />
            </div>
          ))}
        </div>
      </header>

      <main className="relative mx-auto flex w-full max-w-xl flex-1 flex-col justify-center px-4 pb-20 sm:px-6">
        {step === 0 && (
          <div className="animate-rise">
            <p className="label text-lime">step 1 of 3</p>
            <h1 className="font-display mt-3 text-5xl font-extrabold leading-[0.95]">Let&apos;s see what you&apos;ve got.</h1>
            <p className="mt-4 text-muted">We read your public repos to figure out your stack. Nothing gets posted without your OK.</p>
            {authError && (
              <p className="mt-4 rounded-2xl border border-orange/30 bg-orange/5 p-3 text-sm text-orange">
                {authError === "unconfigured"
                  ? "GitHub sign-in isn't set up on this server yet (see README). You can still type your username below."
                  : authError === "denied"
                    ? "Sign-in was cancelled. No worries, try again or type your username."
                    : "GitHub sign-in didn't finish. Please try again."}
              </p>
            )}
            {session.configured && (
              <>
                <a href={signInHref("/onboarding")} className="btn-lime mt-8 w-full py-3.5 text-base">
                  <GithubIcon size={18} /> Continue with GitHub
                </a>
                <p className="mt-2 text-center text-xs text-muted">Needed to open PRs from your account and track your streak.</p>
                <div className="my-6 flex items-center gap-3 text-xs text-muted">
                  <span className="h-px flex-1 bg-line" /> or just look around <span className="h-px flex-1 bg-line" />
                </div>
              </>
            )}
            <form
              className={`${session.configured ? "" : "mt-8"} flex flex-col gap-3`}
              onSubmit={(e) => {
                e.preventDefault();
                if (username.trim()) analyze(false);
              }}
            >
              <label className="flex items-center gap-2 rounded-2xl border border-line bg-surface-2 px-4 focus-within:border-lime/70">
                <GithubIcon className="text-muted" />
                <span className="text-sm text-muted">github.com/</span>
                <input
                  autoFocus
                  className="min-w-0 flex-1 bg-transparent py-3.5 text-sm outline-none"
                  placeholder="username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  spellCheck={false}
                />
              </label>
              <button className={`${session.configured ? "btn-ghost" : "btn-lime"} py-3.5`} disabled={busy || !username.trim()}>
                Continue <ArrowRight className="h-4 w-4" />
              </button>
            </form>
            {busy && <Loader className="mt-6" lines={["Reading your repos…", "Counting your languages…"]} />}
            {error && <div className="mt-6"><ErrorBox error={error} /></div>}
          </div>
        )}

        {step === 1 && data && (
          <div className="animate-rise">
            <div className="mb-8 flex items-center gap-4 rounded-3xl border border-line bg-surface p-4">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={data.user.avatar} alt="" className="h-14 w-14 rounded-2xl" />
              <div className="min-w-0">
                <p className="font-display text-xl font-bold">{data.user.name || data.user.login}</p>
                <p className="truncate text-sm text-muted">
                  {data.user.repos} repos · {data.languages.slice(0, 3).join(", ") || "no languages yet"}
                </p>
              </div>
              <span className="sticker ml-auto rotate-3 bg-lime">hey 👋</span>
            </div>
            <p className="label text-lime">step 2 of 3 · optional</p>
            <h1 className="font-display mt-3 text-5xl font-extrabold leading-[0.95]">Drop your resume.</h1>
            <p className="mt-4 text-muted">Sharpens your matches with skills GitHub can&apos;t see. PDF or text. Skip it if you want.</p>

            <button
              onClick={() => fileRef.current?.click()}
              className="mt-8 flex w-full flex-col items-center justify-center gap-2 rounded-3xl border-2 border-dashed border-line bg-surface/60 p-8 text-sm text-muted transition hover:border-lime/60 hover:text-ink"
            >
              {file ? (
                <>
                  <FileText className="h-7 w-7 text-lime" />
                  <span className="text-ink">{file.name}</span>
                  <span className="text-xs">click to change</span>
                </>
              ) : (
                <>
                  <Upload className="h-7 w-7" />
                  <span>Upload resume (.pdf, .txt, .md)</span>
                </>
              )}
            </button>
            <input ref={fileRef} type="file" accept=".pdf,.txt,.md" hidden onChange={(e) => setFile(e.target.files?.[0] || null)} />
            <textarea
              className="input mt-3 min-h-24 resize-y"
              placeholder="…or paste your skills / resume text"
              value={resumeText}
              onChange={(e) => setResumeText(e.target.value)}
            />
            <div className="mt-4 flex gap-2">
              <button className="btn-ghost" onClick={() => setStep(2)}>Skip</button>
              <button className="btn-lime flex-1" disabled={busy || (!file && !resumeText.trim())} onClick={() => analyze(true)}>
                Analyze resume <ArrowRight className="h-4 w-4" />
              </button>
            </div>
            {busy && <Loader className="mt-6" lines={["Reading your resume…", "Pulling out the good stuff…", "Ignoring the buzzwords…"]} />}
            {error && <div className="mt-6"><ErrorBox error={error} /></div>}
          </div>
        )}

        {step === 2 && data && (
          <div className="animate-rise">
            <button className="btn-quiet -ml-3 mb-4" onClick={() => setStep(1)}><ArrowLeft className="h-4 w-4" /> back</button>
            <p className="label text-lime">step 3 of 3</p>
            <h1 className="font-display mt-3 text-5xl font-extrabold leading-[0.95]">Your stack, confirmed.</h1>
            {data.aiError && <p className="mt-3 text-xs text-orange">AI resume parsing unavailable ({data.aiError}). Used keyword matching instead.</p>}

            <p className="label mt-8">Languages we&apos;ll match on</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {[...new Set([...langs, ...data.languages])].map((l) => {
                const on = langs.includes(l);
                return (
                  <button
                    key={l}
                    onClick={() => setLangs(on ? langs.filter((x) => x !== l) : [...langs, l])}
                    className={`rounded-full border px-3.5 py-1.5 text-sm font-medium transition ${on ? "border-lime bg-lime text-lime-ink" : "border-line bg-surface-2 text-muted"}`}
                  >
                    {on && <Check className="-ml-1 mr-1 inline h-3.5 w-3.5" />}
                    {l}
                  </button>
                );
              })}
            </div>

            <p className="label mt-8">Skills</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {skills.map((s) => (
                <span key={s} className="chip">
                  {s}
                  <button onClick={() => setSkills(skills.filter((x) => x !== s))} aria-label={`remove ${s}`}><X className="h-3 w-3 text-muted hover:text-ink" /></button>
                </span>
              ))}
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const v = newSkill.trim().toLowerCase();
                  if (v && !skills.includes(v)) setSkills([...skills, v]);
                  setNewSkill("");
                }}
                className="inline-flex items-center gap-1 rounded-full border border-dashed border-line px-2.5 py-1"
              >
                <Plus className="h-3 w-3 text-muted" />
                <input value={newSkill} onChange={(e) => setNewSkill(e.target.value)} placeholder="add skill" className="w-20 bg-transparent text-xs outline-none" />
              </form>
            </div>

            <p className="label mt-8">Difficulty</p>
            <div className="mt-3 grid grid-cols-2 gap-2">
              {([
                ["beginner", "🌱 Ease me in", "good first issues"],
                ["intermediate", "⚡ Bring it", "help-wanted issues"],
              ] as const).map(([v, t, d]) => (
                <button
                  key={v}
                  onClick={() => setLevel(v)}
                  className={`rounded-2xl border p-4 text-left transition ${level === v ? "border-lime bg-lime/10" : "border-line bg-surface-2"}`}
                >
                  <p className="font-semibold">{t}</p>
                  <p className="text-xs text-muted">{d}</p>
                </button>
              ))}
            </div>

            <p className="label mt-8">Weekly goal</p>
            <div className="mt-3 flex items-center gap-2">
              {[1, 2, 3, 5].map((n) => (
                <button key={n} onClick={() => setGoal(n)} className={`h-11 flex-1 rounded-2xl border font-display text-lg font-bold transition ${goal === n ? "border-lime bg-lime text-lime-ink" : "border-line bg-surface-2"}`}>
                  {n}
                </button>
              ))}
              <span className="ml-1 text-sm text-muted">PRs / week</span>
            </div>

            <button className="btn-lime mt-10 w-full py-4 text-base" onClick={finish} disabled={!langs.length}>
              Show me my matches <ArrowRight className="h-4 w-4" />
            </button>
          </div>
        )}
      </main>
    </div>
  );
}
