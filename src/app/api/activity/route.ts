import { ACTIVITY_WEIGHTS, recordActivity, type ActivityKind } from "@/lib/activity";
import { errorResponse } from "@/lib/groq";
import { getSession, oauthConfigured } from "@/lib/session";

// Only the signed-in GitHub account can add squares to its own graph.
export async function POST(req: Request) {
  try {
    const session = oauthConfigured() ? await getSession() : null;
    if (!session) return Response.json({ error: "Sign in with GitHub to track activity" }, { status: 401 });
    const { kind } = await req.json();
    if (!(kind in ACTIVITY_WEIGHTS)) return Response.json({ error: "bad activity" }, { status: 400 });
    await recordActivity(session.login, kind as ActivityKind);
    return Response.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
