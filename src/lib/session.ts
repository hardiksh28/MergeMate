// Signed-in session: an AES-256-GCM encrypted, httpOnly cookie. Server-only.
// Holds the user's GitHub OAuth token so PRs open from their account; the browser can never read it.
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";
import { cookies } from "next/headers";

export const SESSION_COOKIE = "mm_session";
const MAX_AGE = 60 * 60 * 24 * 30; // 30 days

export type Session = { login: string; id: number; name: string | null; avatar: string; token: string };

function key() {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) throw new Error("SESSION_SECRET must be set (32+ chars) for GitHub sign-in.");
  return createHash("sha256").update(secret).digest();
}

export function seal(data: unknown) {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key(), iv);
  const body = Buffer.concat([c.update(JSON.stringify(data), "utf8"), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), body]).toString("base64url");
}

export function unseal<T>(value: string | undefined): T | null {
  if (!value) return null;
  try {
    const raw = Buffer.from(value, "base64url");
    const d = createDecipheriv("aes-256-gcm", key(), raw.subarray(0, 12));
    d.setAuthTag(raw.subarray(12, 28));
    return JSON.parse(Buffer.concat([d.update(raw.subarray(28)), d.final()]).toString("utf8")) as T;
  } catch {
    return null;
  }
}

export async function getSession(): Promise<Session | null> {
  return unseal<Session>((await cookies()).get(SESSION_COOKIE)?.value);
}

export async function setSession(s: Session) {
  (await cookies()).set(SESSION_COOKIE, seal(s), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: MAX_AGE,
  });
}

export async function clearSession() {
  (await cookies()).delete(SESSION_COOKIE);
}

export const oauthConfigured = () => !!(process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET && process.env.SESSION_SECRET);
