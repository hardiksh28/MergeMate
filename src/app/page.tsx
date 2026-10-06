import Link from "next/link";
import {
  ArrowRight,
  Brain,
  Check,
  FileCode2,
  Flame,
  GitMerge,
  GitPullRequest,
  ListChecks,
  Mic,
  Search,
  ShieldCheck,
  Sparkles,
  Target,
  Wand2,
} from "lucide-react";
import { SiteFooter, SiteNav } from "@/components/SiteNav";
import { MergeCityCTA, Pricing, TryIt } from "@/components/landing";
import { SectionTitle } from "@/components/ui";
import { LogoMark } from "@/components/Logo";

const REPOS = ["freeCodeCamp", "excalidraw", "appwrite", "supabase", "astro", "zed", "deno", "fastapi", "pandas", "rust-lang", "vercel/next.js", "home-assistant", "tldraw", "mdn", "hoppscotch", "posthog"];

export default function Home() {
  return (
    <>
      <SiteNav />
      <main className="overflow-x-clip">
        {/* HERO */}
        <section className="relative">
          <div className="glow-lime pointer-events-none absolute -top-40 left-1/2 h-[600px] w-[900px] -translate-x-1/2" />
          <div className="glow-violet pointer-events-none absolute top-40 -right-40 h-[500px] w-[500px]" />
          <div className="relative mx-auto grid max-w-6xl items-center gap-12 px-4 pb-20 pt-14 sm:px-6 lg:grid-cols-[1.1fr_0.9fr] lg:pt-20">
            <div className="flex flex-col items-start">
              <span className="chip animate-rise mb-6 border-lime/30 bg-lime/10 text-lime">
                <Sparkles className="h-3.5 w-3.5" /> First 100 get 3 months free
              </span>
              <h1 className="font-display animate-rise text-[3.2rem] font-extrabold leading-[0.92] sm:text-7xl lg:text-[5.4rem]" style={{ animationDelay: "60ms" }}>
                <span className="block">Ship real</span>
                <span className="block">open source.</span>
                <span className="text-gradient block pb-2">Get hired</span>
                <span className="text-gradient block pb-2">for it.</span>
              </h1>
              <p className="animate-rise mt-6 max-w-lg text-lg text-muted" style={{ animationDelay: "120ms" }}>
                MergeMate finds issues that fit your skills, explains the codebase like a senior dev would, preps the fix
                <em className="not-italic text-ink"> with you</em>, and turns every merged PR into proof recruiters actually read.
              </p>
              <div className="animate-rise mt-8 w-full" style={{ animationDelay: "180ms" }}>
                <TryIt />
              </div>
            </div>
            <HeroVisual />
          </div>

          {/* marquee */}
          <div className="relative border-y border-line/60 bg-surface/40 py-4">
            <div className="flex w-max animate-marquee gap-10 whitespace-nowrap text-sm text-muted">
              {[...REPOS, ...REPOS].map((r, i) => (
                <span key={i} className="inline-flex items-center gap-2">
                  <GitMerge className="h-4 w-4 text-lime/70" /> {r}
                </span>
              ))}
            </div>
            <p className="sr-only">Issues pulled live from active open source projects</p>
          </div>
        </section>

        {/* PROBLEM */}
        <section className="mx-auto max-w-6xl px-4 py-24 sm:px-6">
          <SectionTitle
            kicker="the real problem"
            title={<>Writing the fix was <span className="text-lime">never</span> the hard part.</>}
            sub="We read hundreds of dev threads. Almost nobody said “I can't code it.” They said this:"
          />
          <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {[
              { e: "🫠", t: "“The codebase is 40k files. Where do I even start?”", c: "-rotate-2" },
              { e: "🔍", t: "“Took me 3 hours just to find where the bug lives.”", c: "rotate-1" },
              { e: "🧟", t: "“Picked an issue, turns out the repo’s been dead since 2022.”", c: "-rotate-1" },
              { e: "📉", t: "“Got 2 PRs merged, then life happened. Never went back.”", c: "rotate-2" },
            ].map((x) => (
              <div key={x.t} className={`card p-6 transition hover:rotate-0 ${x.c}`}>
                <p className="text-3xl">{x.e}</p>
                <p className="font-display mt-4 text-xl font-bold leading-snug">{x.t}</p>
              </div>
            ))}
          </div>
        </section>

        {/* HOW IT WORKS */}
        <section id="how" className="mx-auto max-w-6xl scroll-mt-20 px-4 py-24 sm:px-6">
          <SectionTitle kicker="how it works" title="From “where do I start” to merged." sub="Six steps. AI does the heavy lifting. You stay in control of every PR." />
          <div className="mt-14 grid gap-4 md:grid-cols-3">
            {[
              { i: Target, n: "01", t: "Get matched", d: "Issues from active, well-maintained repos that fit your languages, resume and level. Dead repos filtered out.", color: "text-lime" },
              { i: Brain, n: "02", t: "Understand the code", d: "Only the files that matter, with a plain-English map of how that part of the project works.", color: "text-sky" },
              { i: Search, n: "03", t: "Find it yourself", d: "Take a guess at where the fix goes. MergeMate tells you how close you are. That’s how you actually learn.", color: "text-violet" },
              { i: Wand2, n: "04", t: "Prep the fix", d: "A drafted change with a step-by-step “why”, in the project’s own code style.", color: "text-pink" },
              { i: ShieldCheck, n: "05", t: "Review & submit", d: "Read the diff, pass the CONTRIBUTING.md check, explain it in your words, then open the PR from your account.", color: "text-orange" },
              { i: GitMerge, n: "06", t: "Track & flex", d: "Decode maintainer comments, reply like a pro, and every merge lands on your public profile.", color: "text-lime" },
            ].map((s) => (
              <div key={s.n} className="card group relative overflow-hidden p-7 transition hover:-translate-y-1 hover:border-muted/40">
                <span className="font-display absolute -right-2 -top-6 text-[7rem] font-extrabold text-surface-3 transition group-hover:text-surface-3/80">{s.n}</span>
                <s.i className={`relative h-7 w-7 ${s.color}`} />
                <h3 className="font-display relative mt-6 text-2xl font-bold">{s.t}</h3>
                <p className="relative mt-2 text-sm leading-relaxed text-muted">{s.d}</p>
              </div>
            ))}
          </div>
        </section>

        {/* WORKSPACE PREVIEW */}
        <section className="mx-auto max-w-6xl px-4 py-12 sm:px-6">
          <div className="card relative overflow-hidden p-2">
            <div className="flex items-center gap-2 border-b border-line px-4 py-3">
              <span className="h-3 w-3 rounded-full bg-red/70" />
              <span className="h-3 w-3 rounded-full bg-orange/70" />
              <span className="h-3 w-3 rounded-full bg-lime/70" />
              <span className="ml-3 text-xs text-muted">mergemate.app/issue/excalidraw/excalidraw/8123</span>
            </div>
            <div className="grid gap-2 p-2 lg:grid-cols-[220px_1fr_1fr]">
              <div className="rounded-2xl bg-surface-2 p-4">
                {["Understand", "Find it", "Prep fix", "Check", "Submit"].map((s, i) => (
                  <div key={s} className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm ${i === 1 ? "bg-lime text-lime-ink font-semibold" : i < 1 ? "text-ink" : "text-muted"}`}>
                    <span className={`flex h-5 w-5 items-center justify-center rounded-full text-[10px] ${i < 1 ? "bg-lime/20 text-lime" : i === 1 ? "bg-lime-ink/15" : "bg-surface-3"}`}>
                      {i < 1 ? <Check className="h-3 w-3" /> : i + 1}
                    </span>
                    {s}
                  </div>
                ))}
              </div>
              <div className="rounded-2xl bg-surface-2 p-5">
                <p className="label">Your guess</p>
                <p className="mt-3 rounded-xl border border-line bg-bg/60 p-3 font-mono text-xs leading-relaxed text-ink/80">
                  I think the export clips because <span className="text-lime">getCanvasSize()</span> ignores the padding option in <span className="text-sky">export.ts</span>
                </p>
                <div className="mt-4 rounded-xl border border-lime/30 bg-lime/10 p-3 text-sm">
                  <p className="font-semibold text-lime">🎯 Nailed it.</p>
                  <p className="mt-1 text-ink/80">Right file, right function. Now check where <code className="inline">exportPadding</code> gets dropped.</p>
                </div>
              </div>
              <div className="rounded-2xl bg-surface-2 p-5 font-mono text-xs leading-6">
                <p className="label mb-3 font-sans">src/scene/export.ts</p>
                <p className="text-muted">  const [minX, minY, w, h] =</p>
                <p className="bg-red/10 text-red">-   getCanvasSize(elements);</p>
                <p className="bg-lime/10 text-lime">+   getCanvasSize(elements, exportPadding);</p>
                <p className="text-muted">  canvas.width = w * scale;</p>
                <p className="mt-4 font-sans text-[11px] text-muted">✓ follows CONTRIBUTING.md · ✓ links issue · ✓ tests listed</p>
              </div>
            </div>
          </div>
          <p className="mt-3 text-center text-xs text-muted">Illustration of the guided workspace</p>
        </section>

        {/* PROFILE */}
        <section id="profile" className="mx-auto grid max-w-6xl scroll-mt-20 items-center gap-12 px-4 py-24 sm:px-6 lg:grid-cols-2">
          <div>
            <p className="label mb-3 text-lime">proof of work</p>
            <h2 className="font-display text-4xl font-extrabold leading-[1.02] sm:text-5xl">
              Green squares are cute.
              <br />
              <span className="text-gradient">Receipts get offers.</span>
            </h2>
            <p className="mt-5 text-lg text-muted">
              Your public MergeMate profile shows the live GitHub green map, every merged PR in plain English, skills proven by real code, and your streak. One link for your resume, LinkedIn and every application.
            </p>
            <ul className="mt-6 space-y-3 text-sm">
              {["Recruiter-readable PR summaries", "Skills backed by merged code, not keywords", "Interview prep for every PR so you can explain it cold"].map((f) => (
                <li key={f} className="flex items-center gap-3"><span className="flex h-6 w-6 items-center justify-center rounded-full bg-lime/15"><Check className="h-3.5 w-3.5 text-lime" /></span>{f}</li>
              ))}
            </ul>
            <Link href="/u/sindresorhus" className="btn-ghost mt-8">See a live profile <ArrowRight className="h-4 w-4" /></Link>
          </div>
          <ProfileMock />
        </section>

        {/* FEATURES BENTO */}
        <section className="mx-auto max-w-6xl px-4 py-24 sm:px-6">
          <SectionTitle kicker="the toolkit" title="Everything between “good first issue” and “merged”." />
          <div className="mt-12 grid gap-4 md:grid-cols-6">
            <Feature className="md:col-span-4" icon={ShieldCheck} color="text-lime" title="Maintainer-safe by design" text="No spray-and-pray AI PRs. You read the diff, explain it in your own words, and approve every submission. Maintainers can tell, and they merge it." />
            <Feature className="md:col-span-2" icon={ListChecks} color="text-sky" title="CONTRIBUTING.md checker" text="Reads each repo’s rules and PR template, then fixes your title and body before you hit submit." />
            <Feature className="md:col-span-2" icon={Mic} color="text-pink" title="Interview prep per PR" text="A 30-sec pitch, STAR story and the questions you’ll get asked, with model answers." />
            <Feature className="md:col-span-2" icon={Flame} color="text-orange" title="Streaks that don’t guilt-trip" text="Weekly goals, not daily pressure. Reminders that suggest a 15-min fix, not “you’ve been gone”." />
            <Feature className="md:col-span-2" icon={GitPullRequest} color="text-violet" title="Review comment decoder" text="“nit: prefer early return”, explained, with a reply drafted and a todo list." />
          </div>
        </section>

        {/* PRICING */}
        <section id="pricing" className="mx-auto max-w-6xl scroll-mt-20 px-4 py-24 sm:px-6">
          <SectionTitle
            kicker="early access pricing"
            title={<>Early = cheap. <span className="text-lime">Forever.</span></>}
            sub="Prices rise every 100 members. Whatever you lock in, you keep for as long as you stay subscribed. Less than one Swiggy order for an internship-ready profile."
          />
          <div className="mt-12">
            <Pricing />
          </div>
        </section>

        {/* WAITLIST */}
        <section id="waitlist" className="relative mx-auto max-w-6xl scroll-mt-20 px-4 py-24 sm:px-6">
          <div className="glow-lime pointer-events-none absolute inset-x-0 top-0 mx-auto h-[400px] w-[700px]" />
          <div className="relative">
            <div className="mb-8 flex justify-center"><LogoMark size={64} className="animate-floaty" /></div>
            <SectionTitle title="Claim your spot in MergeCity." sub="The MergeMate waitlist is a 3D city. Join, get a house on your own plot, invite mates to stack floors, and lock your early price." />
            <div className="mt-10"><MergeCityCTA /></div>
          </div>
        </section>

        {/* FAQ */}
        <section className="mx-auto max-w-3xl px-4 py-24 sm:px-6">
          <SectionTitle title="Questions, answered." />
          <div className="mt-10 space-y-3">
            {[
              ["Isn’t this just AI writing my PRs?", "No. You find the bug yourself first (MergeMate tells you how close you are), you review the full diff, and you write the explanation. The AI is your senior dev pair, not a ghostwriter. Every PR needs your approval."],
              ["Will maintainers hate it?", "Maintainers hate low-effort, unreviewed AI PRs. MergeMate checks each repo’s CONTRIBUTING.md, keeps changes minimal, links the issue, and lets you open it as a draft first."],
              ["Which languages work?", "Anything on GitHub. Matching is strongest for JavaScript/TypeScript, Python, Go, Rust and Java right now."],
              ["What do I get for free?", "2 fully guided issues every month, the codebase explainer and your public profile. Forever."],
              ["Is the early price really locked?", "Yes. Whatever tier you join at is your price for as long as you stay subscribed."],
            ].map(([q, a]) => (
              <details key={q} className="card group p-5 [&_summary::-webkit-details-marker]:hidden">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-display text-lg font-bold">
                  {q}
                  <span className="text-2xl text-lime transition group-open:rotate-45">+</span>
                </summary>
                <p className="mt-3 text-muted">{a}</p>
              </details>
            ))}
          </div>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}

function Feature({ className, icon: Icon, color, title, text }: { className: string; icon: typeof Check; color: string; title: string; text: string }) {
  return (
    <div className={`card p-7 transition hover:border-muted/40 ${className}`}>
      <Icon className={`h-7 w-7 ${color}`} />
      <h3 className="font-display mt-5 text-2xl font-bold">{title}</h3>
      <p className="mt-2 text-sm leading-relaxed text-muted">{text}</p>
    </div>
  );
}

function HeroVisual() {
  return (
    <div className="relative mx-auto hidden w-full max-w-md lg:block" aria-hidden>
      <div className="card rotate-[2deg] p-5 shadow-2xl shadow-black/50">
        <div className="flex items-center gap-2 text-xs text-muted">
          <span className="h-5 w-5 rounded-md bg-gradient-to-br from-violet to-pink" />
          tldraw/tldraw
          <span className="ml-auto font-mono font-semibold text-lime">94% match</span>
        </div>
        <p className="font-display mt-3 text-xl font-bold leading-tight">Arrow labels overlap when zoomed below 50%</p>
        <div className="mt-3 flex gap-2">
          <span className="rounded-full border border-lime/30 bg-lime/15 px-2 py-0.5 text-[11px] font-semibold text-lime">🌱 Easy</span>
          <span className="chip text-[11px]">TypeScript</span>
          <span className="chip text-[11px]">~30 min</span>
        </div>
        <div className="mt-4 space-y-1.5 text-xs text-muted">
          <p>✓ TypeScript is your main language</p>
          <p>✓ Maintainers active this week</p>
          <p>✓ Nobody&apos;s on it yet</p>
        </div>
        <div className="mt-5 flex items-center gap-2 rounded-2xl bg-surface-2 p-3">
          <FileCode2 className="h-4 w-4 text-sky" />
          <span className="font-mono text-xs">shapes/arrow/arrowLabel.ts</span>
          <span className="ml-auto text-[10px] text-muted">core</span>
        </div>
      </div>

      <div className="sticker animate-floaty absolute -left-12 -top-5 bg-lime text-sm" style={{ ["--r" as string]: "-8deg" }}>
        <GitMerge className="h-4 w-4" /> PR merged!
      </div>
      <div className="sticker animate-floaty absolute -right-6 -top-10 bg-orange text-sm" style={{ ["--r" as string]: "6deg", animationDelay: "1s" }}>
        <Flame className="h-4 w-4" /> 12 week streak
      </div>
      <div className="sticker animate-floaty absolute -bottom-6 right-10 bg-violet text-sm" style={{ ["--r" as string]: "-4deg", animationDelay: "2s" }}>
        <Mic className="h-4 w-4" /> interview-ready
      </div>
      <div className="card animate-floaty absolute -bottom-14 -left-8 w-56 p-3" style={{ ["--r" as string]: "-3deg", animationDelay: "1.5s" }}>
        <div className="grid grid-cols-[repeat(14,1fr)] gap-[3px]">
          {Array.from({ length: 56 }, (_, i) => {
            const v = (i * 37 + 11) % 7;
            return <span key={i} className={`aspect-square rounded-[3px] ${v > 4 ? "bg-lime" : v > 2 ? "bg-lime/50" : v > 0 ? "bg-lime/20" : "bg-surface-3"}`} />;
          })}
        </div>
      </div>
    </div>
  );
}

function ProfileMock() {
  return (
    <div className="card relative p-6" aria-hidden>
      <div className="flex items-center gap-4">
        <div className="h-14 w-14 rounded-2xl bg-gradient-to-br from-lime via-sky to-violet" />
        <div>
          <p className="font-display text-xl font-bold">Ananya R.</p>
          <p className="text-sm text-muted">TypeScript · React · Python · 3rd yr CSE</p>
        </div>
        <span className="sticker ml-auto rotate-3 bg-lime">✓ verified PRs</span>
      </div>
      <div className="mt-6 grid grid-cols-3 gap-3 text-center">
        {[["14", "merged PRs"], ["9", "repos"], ["11w", "streak"]].map(([n, l]) => (
          <div key={l} className="rounded-2xl bg-surface-2 py-3">
            <p className="font-display text-2xl font-extrabold text-lime">{n}</p>
            <p className="text-[11px] text-muted">{l}</p>
          </div>
        ))}
      </div>
      <div className="mt-5 grid grid-cols-[repeat(26,1fr)] gap-[3px]">
        {Array.from({ length: 182 }, (_, i) => {
          const v = (i * 53 + 7) % 9;
          return <span key={i} className={`aspect-square rounded-[2px] ${v > 6 ? "bg-lime" : v > 4 ? "bg-lime/55" : v > 2 ? "bg-lime/25" : "bg-surface-3"}`} />;
        })}
      </div>
      <div className="mt-5 space-y-2">
        {[
          ["excalidraw", "Fixed export clipping when padding was set on large canvases"],
          ["fastapi", "Added missing type hints to dependency override docs example"],
        ].map(([r, s]) => (
          <div key={r} className="flex items-start gap-3 rounded-2xl bg-surface-2 p-3">
            <GitMerge className="mt-0.5 h-4 w-4 shrink-0 text-violet" />
            <div>
              <p className="text-xs text-muted">{r}</p>
              <p className="text-sm">{s}</p>
            </div>
          </div>
        ))}
      </div>
      <p className="mt-3 text-center text-[11px] text-muted">Sample profile</p>
    </div>
  );
}
