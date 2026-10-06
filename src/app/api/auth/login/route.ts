import { randomBytes } from "crypto";
import { cookies } from "next/headers";
import { oauthConfigured } from "@/lib/session";

// public_repo lets MergeMate fork, commit and open PRs as the user; read:user for the profile.
const SCOPES = "read:user public_repo";

export async function GET(req: Request) {
  const url = new URL(req.url);
  if (!oauthConfigured()) {
    return Response.redirect(new URL("/onboarding?auth=unconfigured", url.origin));
  }
  const state = randomBytes(16).toString("hex");
  const next = url.searchParams.get("next") || "/app";
  (await cookies()).set("mm_oauth", JSON.stringify({ state, next: next.startsWith("/") ? next : "/app" }), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 600,
  });
  const gh = new URL("https://github.com/login/oauth/authorize");
  gh.searchParams.set("client_id", process.env.GITHUB_CLIENT_ID!);
  gh.searchParams.set("redirect_uri", `${url.origin}/api/auth/callback`);
  gh.searchParams.set("scope", SCOPES);
  gh.searchParams.set("state", state);
  gh.searchParams.set("allow_signup", "true");
  return Response.redirect(gh.toString());
}
