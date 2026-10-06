import { getSession, oauthConfigured } from "@/lib/session";

export async function GET() {
  const s = oauthConfigured() ? await getSession() : null;
  return Response.json({
    configured: oauthConfigured(),
    user: s ? { login: s.login, name: s.name, avatar: s.avatar } : null,
  });
}
