import { ACTIVITY_WEIGHTS, recordActivity, type ActivityKind } from "@/lib/activity";
import { dbConfigured, logEvent } from "@/lib/db";
import { errorResponse } from "@/lib/groq";
import { getSession, oauthConfigured } from "@/lib/session";

// Funnel-only events: tracked for the admin dashboard, not drawn on the activity graph.
const FUNNEL_ONLY = new Set(["onboard"]);

// Only the signed-in GitHub account can add squares to its own graph.
export async function POST(req: Request) {
  try {
    const session = oauthConfigured() ? await getSession() : null;
    if (!session) return Response.json({ error: "Sign in with GitHub to track activity" }, { status: 401 });
    const { kind, meta } = await req.json();
    if (!(kind in ACTIVITY_WEIGHTS) && !FUNNEL_ONLY.has(kind)) return Response.json({ error: "bad activity" }, { status: 400 });
    const safeMeta = meta && typeof meta === "object" && JSON.stringify(meta).length <= 500 ? meta : undefined;
    if (dbConfigured()) await logEvent(kind, { id: session.id, login: session.login }, safeMeta);
    else if (kind in ACTIVITY_WEIGHTS) await recordActivity(session.login, kind as ActivityKind);
    return Response.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
