import { cookies } from "next/headers";
import { gh } from "@/lib/github";
import { setSession } from "@/lib/session";
import { logEvent, touchUser } from "@/lib/db";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const fail = (reason: string) => Response.redirect(new URL(`/onboarding?auth=${reason}`, url.origin));
  const jar = await cookies();
  let saved: { state: string; next: string } | null = null;
  try {
    saved = JSON.parse(jar.get("mm_oauth")?.value || "null");
  } catch {}
  jar.delete("mm_oauth");

  const code = url.searchParams.get("code");
  if (url.searchParams.get("error")) return fail("denied");
  if (!code || !saved || saved.state !== url.searchParams.get("state")) return fail("state");

  const res = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: process.env.GITHUB_CLIENT_ID,
      client_secret: process.env.GITHUB_CLIENT_SECRET,
      code,
      redirect_uri: `${url.origin}/api/auth/callback`,
    }),
  });
  const tok = (await res.json().catch(() => ({}))) as { access_token?: string };
  if (!tok.access_token) return fail("token");

  try {
    const u = await gh<{ login: string; id: number; name: string | null; avatar_url: string }>("/user", { token: tok.access_token });
    await setSession({ login: u.login, id: u.id, name: u.name, avatar: u.avatar_url, token: tok.access_token });
    await touchUser({ id: u.id, login: u.login, name: u.name, avatar: u.avatar_url });
    await logEvent("signin", { id: u.id, login: u.login });
  } catch {
    return fail("token");
  }
  return Response.redirect(new URL(saved.next, url.origin));
}
