import { dbConfigured, isAdmin, keyRole, rpc } from "@/lib/db";
import { cityResidents } from "@/lib/mergecity";
import { getSession, oauthConfigured } from "@/lib/session";

export type AdminStats = {
  users: number;
  new_today: number;
  new_7d: number;
  active_today: number;
  active_7d: number;
  by_kind: Record<string, number>;
  funnel: { signed_in: number; onboarded: number; started: number; fixed: number; pr: number };
  daily: { day: string; signups: number; active: number; prs: number; lookups: number }[];
  people: { login: string; name: string | null; avatar: string; created_at: string; last_seen: string; sign_ins: number; starts: number; prs: number; actions: number }[];
  recent: { login: string | null; kind: string; meta: Record<string, unknown> | null; created_at: string }[];
};

// Only GitHub accounts listed in ADMIN_GITHUB_LOGINS (default: hardiksh28) get in.
export async function GET() {
  const session = oauthConfigured() ? await getSession() : null;
  if (!session) return Response.json({ error: "signin" }, { status: 401 });
  if (!isAdmin(session.login)) return Response.json({ error: "forbidden", login: session.login }, { status: 403 });
  if (!dbConfigured()) return Response.json({ error: "nodb" }, { status: 503 });
  try {
    const [stats, residents] = await Promise.all([rpc<AdminStats>("mm_admin_stats"), cityResidents().catch(() => [])]);
    return Response.json({
      stats,
      city: {
        total: residents.length,
        founders: residents.filter((r) => r.tier === "founder").length,
        latest: residents.slice(-5).reverse(),
      },
    });
  } catch (e) {
    const role = keyRole();
    const detail =
      role !== "service_role"
        ? `MERGEMATE_SUPABASE_SERVICE_KEY is the ${role} key. It must be the service_role (secret) key from Supabase → Project Settings → API Keys.`
        : (e as Error).message;
    return Response.json({ error: "query", detail }, { status: 500 });
  }
}
