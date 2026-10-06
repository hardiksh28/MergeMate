// MergeCity (the 3D waitlist at merge-city.vercel.app) is the MergeMate waitlist.
// Server-only, read-only access to its public residents view in Supabase.
import { TIERS } from "./pricing";

export type CityResident = {
  github: string | null;
  handle: string; // name on the door
  tier: "free" | "founder" | "team";
  floors: number;
  place: number;
  joinedAt: string;
};

const URL_ = process.env.MERGECITY_SUPABASE_URL;
const KEY = process.env.MERGECITY_SUPABASE_ANON_KEY;
export const mergeCityConfigured = () => !!(URL_ && KEY);

let cache: { at: number; data: CityResident[] } | null = null;

/** Every visible resident, ordered by place in line. Cached for 60s. */
export async function cityResidents(): Promise<CityResident[]> {
  if (!mergeCityConfigured()) return [];
  if (cache && Date.now() - cache.at < 60_000) return cache.data;
  const res = await fetch(
    `${URL_}/rest/v1/public_residents?select=handle,github,tier,floors,place,created_at&order=place.asc&limit=5000`,
    { headers: { apikey: KEY!, Authorization: `Bearer ${KEY}` }, cache: "no-store" },
  );
  if (!res.ok) throw new Error(`MergeCity ${res.status}`);
  const rows = (await res.json()) as { handle: string; github: string | null; tier: CityResident["tier"]; floors: number; place: number; created_at: string }[];
  const data = rows.map((r) => ({
    github: r.github,
    handle: r.handle,
    tier: r.tier,
    floors: r.floors,
    place: Number(r.place),
    joinedAt: r.created_at,
  }));
  cache = { at: Date.now(), data };
  return data;
}

/** Spot counters for the pricing tiers, from the real number of MergeCity residents. */
export function tierCounts(total: number) {
  let start = 0;
  return TIERS.map((t) => {
    const taken = t.spots === null ? Math.max(0, total - start) : Math.max(0, Math.min(t.spots, total - start));
    if (t.spots) start += t.spots;
    return { ...t, taken, left: t.spots === null ? null : t.spots - taken };
  });
}
