import { cityResidents, tierCounts } from "@/lib/mergecity";

// The waitlist lives in MergeCity. This returns its live numbers for pricing and the in-app city card.
export async function GET() {
  try {
    const residents = await cityResidents();
    return Response.json({
      total: residents.length,
      tiers: tierCounts(residents.length),
      residents: residents.map((r) => ({ username: r.github || "", handle: r.handle, floors: r.floors, position: r.place, tier: r.tier })),
    });
  } catch {
    return Response.json({ total: 0, tiers: tierCounts(0), residents: [], error: "MergeCity unavailable" });
  }
}
