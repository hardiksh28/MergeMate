// MergeMate's own data (users + events) in Supabase, via PostgREST RPC calls. Server-only.
// Tables and functions live in supabase/mergemate.sql. Uses the service role key, so it must never reach the browser.
const URL_ = process.env.MERGEMATE_SUPABASE_URL || process.env.MERGECITY_SUPABASE_URL;
const KEY = process.env.MERGEMATE_SUPABASE_SERVICE_KEY;

export const dbConfigured = () => !!(URL_ && KEY);

/** Which Supabase role the configured key acts as, without revealing the key. */
export function keyRole(): string {
  if (!KEY) return "missing";
  if (KEY.startsWith("sb_secret_")) return "service_role";
  if (KEY.startsWith("sb_publishable_")) return "anon (publishable key)";
  try {
    return JSON.parse(Buffer.from(KEY.split(".")[1], "base64url").toString()).role || "unknown";
  } catch {
    return "unknown";
  }
}

export async function rpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  if (!dbConfigured()) throw new Error("Database not configured");
  const res = await fetch(`${URL_}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: { apikey: KEY!, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify(args),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`DB ${fn} ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const text = await res.text();
  return (text ? JSON.parse(text) : null) as T;
}

export type EventKind = "signin" | "onboard" | "match" | "start" | "guess" | "fix" | "check" | "pr" | "prep" | "reply";

/** Best effort: tracking must never break the request it rides on. */
export async function logEvent(kind: EventKind, user: { id: number; login: string } | null, meta?: Record<string, unknown>) {
  if (!dbConfigured()) return;
  try {
    await rpc("mm_log_event", { p_user_id: user?.id ?? null, p_login: user?.login ?? null, p_kind: kind, p_meta: meta ?? null });
  } catch (e) {
    console.warn("[db] log failed:", (e as Error).message);
  }
}

export async function touchUser(u: { id: number; login: string; name: string | null; avatar: string }) {
  if (!dbConfigured()) return;
  try {
    await rpc("mm_touch_user", { p_id: u.id, p_login: u.login, p_name: u.name, p_avatar: u.avatar });
  } catch (e) {
    console.warn("[db] touch failed:", (e as Error).message);
  }
}

/** GitHub logins allowed into /admin. Comma-separated in ADMIN_GITHUB_LOGINS. */
export const isAdmin = (login?: string | null) =>
  !!login &&
  (process.env.ADMIN_GITHUB_LOGINS || "hardiksh28")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .includes(login.toLowerCase());
