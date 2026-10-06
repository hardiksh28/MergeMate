"use client";
import { useEffect, useState } from "react";
import { ArrowRight } from "lucide-react";
import { api } from "@/lib/client";
import { MERGECITY_URL } from "@/lib/city-link";

export type Resident = { username: string; handle: string; floors: number; position: number; tier: "free" | "founder" | "team" };

let cache: Promise<{ residents: Resident[]; total: number }> | null = null;
/** Waitlist residents, fetched once per page load and shared by every caller. */
export function loadCity() {
  cache ||= api<{ residents: Resident[]; total: number }>("/api/waitlist").catch((e) => {
    cache = null;
    throw e;
  });
  return cache;
}

export function useResident(username?: string | null) {
  const [state, setState] = useState<{ me: Resident | null; total: number } | null>(null);
  useEffect(() => {
    if (!username) return;
    loadCity()
      .then((d) => setState({ me: d.residents.find((r) => r.username.toLowerCase() === username.toLowerCase()) || null, total: d.total }))
      .catch(() => setState({ me: null, total: 0 }));
  }, [username]);
  return state;
}

/** MergeCity is a separate app; it finds the visitor's own house once they're signed in there. */
export const cityHref = () => MERGECITY_URL;
const ext = { target: "_blank", rel: "noreferrer" } as const;
const district = (t: Resident["tier"]) => (t === "founder" ? "Main Street founder" : t === "team" ? "Downtown tower" : "Outskirts");

/** Tiny isometric house: one block per floor. */
function MiniHouse({ floors }: { floors: number }) {
  const f = Math.min(4, Math.max(1, floors));
  return (
    <svg viewBox="0 0 40 44" className="h-11 w-10 shrink-0" aria-hidden>
      <polygon points="20,40 36,32 20,24 4,32" fill="#1b1f10" />
      {Array.from({ length: f }, (_, i) => {
        const y = 30 - i * 7;
        return (
          <g key={i}>
            <polygon points={`8,${y} 20,${y + 6} 20,${y - 1} 8,${y - 7}`} fill="#a9cc2e" />
            <polygon points={`20,${y + 6} 32,${y} 32,${y - 7} 20,${y - 1}`} fill="#7f9922" />
          </g>
        );
      })}
      <polygon points={`8,${30 - (f - 1) * 7 - 7} 20,${30 - (f - 1) * 7 - 1} 32,${30 - (f - 1) * 7 - 7} 20,${30 - (f - 1) * 7 - 13}`} fill="#d4ff3a" />
    </svg>
  );
}

/** "Your house in MergeCity" card for the app sidebar. */
export function CityCard({ username }: { username: string }) {
  const r = useResident(username);
  if (!r) return <div className="skeleton h-[74px]" />;
  return (
    <a href={cityHref()} {...ext} className="group flex items-center gap-3 rounded-2xl border border-line bg-surface-2 p-3 transition hover:border-lime/40">
      <MiniHouse floors={r.me?.floors || 1} />
      <div className="min-w-0 flex-1">
        <p className="label">MergeCity</p>
        <p className="truncate text-sm font-semibold">
          {r.me ? `${r.me.handle} · #${r.me.position}` : "Claim your house"}
        </p>
        <p className="truncate text-xs text-muted">
          {r.me ? `${district(r.me.tier)} · ${r.me.floors} floor${r.me.floors > 1 ? "s" : ""}` : `${r.total} dev${r.total === 1 ? "" : "s"} live there`}
        </p>
      </div>
      <ArrowRight className="h-4 w-4 shrink-0 text-muted transition group-hover:translate-x-0.5 group-hover:text-lime" />
    </a>
  );
}

/** Small badge for the public profile. Renders nothing when the user isn't a resident. */
export function ResidentBadge({ username }: { username: string }) {
  const r = useResident(username);
  if (!r?.me) return null;
  return (
    <a href={cityHref()} {...ext} className="chip border-lime/30 bg-lime/10 text-lime transition hover:bg-lime/20">
      🏠 MergeCity #{r.me.position}{r.me.tier === "founder" ? " · founder" : ""}
    </a>
  );
}
