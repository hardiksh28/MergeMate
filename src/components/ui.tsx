"use client";
import { useEffect, useState, type ReactNode } from "react";
import { TriangleAlert, KeyRound } from "lucide-react";
import Link from "next/link";

export function GithubIcon({ size = 16, className = "" }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden>
      <path d="M12 .5C5.65.5.5 5.65.5 12a11.5 11.5 0 0 0 7.86 10.92c.58.1.79-.25.79-.56v-2c-3.2.7-3.88-1.37-3.88-1.37-.52-1.33-1.28-1.69-1.28-1.69-1.04-.71.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.03 1.76 2.7 1.25 3.36.96.1-.75.4-1.25.73-1.54-2.55-.29-5.24-1.28-5.24-5.68 0-1.26.45-2.28 1.19-3.09-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.17 1.18a11 11 0 0 1 5.77 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.76.11 3.05.74.81 1.19 1.83 1.19 3.09 0 4.41-2.69 5.38-5.26 5.67.41.36.78 1.06.78 2.14v3.17c0 .31.21.67.8.56A11.5 11.5 0 0 0 23.5 12C23.5 5.65 18.35.5 12 .5Z" />
    </svg>
  );
}

/** Renders AI text: `code` spans and **bold**, nothing else. */
export function Rich({ text, className = "" }: { text: string; className?: string }) {
  const parts = String(text || "").split(/(`[^`]+`|\*\*[^*]+\*\*)/g);
  return (
    <span className={`prose-mm ${className}`}>
      {parts.map((p, i) =>
        p.startsWith("`") && p.endsWith("`") ? (
          <code key={i}>{p.slice(1, -1)}</code>
        ) : p.startsWith("**") && p.endsWith("**") ? (
          <strong key={i} className="text-ink">
            {p.slice(2, -2)}
          </strong>
        ) : (
          <span key={i}>{p}</span>
        ),
      )}
    </span>
  );
}

const TONES = {
  lime: ["bg-surface-3", "bg-lime/25", "bg-lime/50", "bg-lime/75", "bg-lime"],
  violet: ["bg-surface-3", "bg-violet/25", "bg-violet/50", "bg-violet/75", "bg-violet"],
} as const;

export function ContribGraph({
  days,
  cell = 11,
  showMonths = true,
  tone = "lime",
  unit = "contributions",
}: {
  days: { date: string; count: number; level: number }[];
  cell?: number;
  tone?: keyof typeof TONES;
  unit?: string;
  showMonths?: boolean;
}) {
  if (!days.length) return <div className="skeleton h-28 w-full" />;
  // group into weeks starting Sunday
  const weeks: (typeof days)[] = [];
  let week: typeof days = [];
  const firstDow = new Date(days[0].date + "T00:00:00").getDay();
  for (let i = 0; i < firstDow; i++) week.push({ date: "", count: -1, level: -1 });
  for (const d of days) {
    week.push(d);
    if (week.length === 7) {
      weeks.push(week);
      week = [];
    }
  }
  if (week.length) weeks.push(week);
  const months: { i: number; label: string }[] = [];
  weeks.forEach((w, i) => {
    const d = w.find((x) => x.date);
    if (!d) return;
    const m = new Date(d.date + "T00:00:00").toLocaleString("en", { month: "short" });
    if (!months.length || months[months.length - 1].label !== m) months.push({ i, label: m });
  });
  const gap = Math.max(2, Math.round(cell / 4));
  return (
    <div className="scroll-thin overflow-x-auto pb-1">
      <div className="inline-block">
        {showMonths && (
          <div className="relative mb-1.5 h-4 text-[10px] text-muted">
            {months.map((m) => (
              <span key={m.i} className="absolute" style={{ left: m.i * (cell + gap) }}>
                {m.label}
              </span>
            ))}
          </div>
        )}
        <div className="flex" style={{ gap }}>
          {weeks.map((w, i) => (
            <div key={i} className="flex flex-col" style={{ gap }}>
              {w.map((d, j) => (
                <div
                  key={j}
                  title={d.date ? `${d.count} ${unit} on ${d.date}` : ""}
                  className={d.level < 0 ? "" : TONES[tone][d.level] || TONES[tone][4]}
                  style={{ width: cell, height: cell, borderRadius: Math.max(2, cell / 4) }}
                />
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function Loader({ lines, className = "" }: { lines: string[]; className?: string }) {
  const [i, setI] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setI((x) => (x + 1) % lines.length), 2200);
    return () => clearInterval(t);
  }, [lines.length]);
  return (
    <div className={`flex items-center gap-3 text-sm text-muted ${className}`}>
      <span className="relative flex h-3 w-3">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-lime opacity-60" />
        <span className="relative inline-flex h-3 w-3 rounded-full bg-lime" />
      </span>
      <span key={i} className="animate-rise">
        {lines[i]}
      </span>
    </div>
  );
}

export function ErrorBox({ error, onRetry }: { error: string; onRetry?: () => void }) {
  const keyIssue = /groq|api key|github token|rate limit/i.test(error);
  return (
    <div className="rounded-2xl border border-red/30 bg-red/5 p-4 text-sm">
      <div className="flex items-start gap-3">
        <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-red" />
        <div className="flex-1">
          <p className="text-ink/90">{error}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {onRetry && (
              <button onClick={onRetry} className="btn-ghost py-1.5 text-xs">
                Try again
              </button>
            )}
            {keyIssue && (
              <Link href="/app/settings" className="btn-ghost py-1.5 text-xs">
                <KeyRound className="h-3.5 w-3.5" /> Open settings
              </Link>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export function SectionTitle({ kicker, title, sub }: { kicker?: string; title: ReactNode; sub?: ReactNode }) {
  return (
    <div className="mx-auto max-w-2xl text-center">
      {kicker && <p className="label mb-3 text-lime">{kicker}</p>}
      <h2 className="font-display text-4xl font-extrabold leading-[1.02] sm:text-5xl">{title}</h2>
      {sub && <p className="mt-4 text-base text-muted sm:text-lg">{sub}</p>}
    </div>
  );
}

export function DifficultyPill({ d }: { d: "Easy" | "Medium" | "Spicy" }) {
  const map = {
    Easy: "bg-lime/15 text-lime border-lime/30",
    Medium: "bg-sky/10 text-sky border-sky/30",
    Spicy: "bg-pink/10 text-pink border-pink/30",
  } as const;
  const emoji = { Easy: "🌱", Medium: "⚡", Spicy: "🌶️" }[d];
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold ${map[d]}`}>
      {emoji} {d}
    </span>
  );
}
