import { ImageResponse } from "next/og";
import { contributions, getUser, streaks, userPRs } from "@/lib/github";

export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = "MergeMate open source profile";

const LEVEL = ["#212128", "#4f5e1c", "#7e9a26", "#aed12f", "#d4ff3a"];

export default async function OG({ params }: { params: Promise<{ username: string }> }) {
  const { username } = await params;
  const [user, days, merged] = await Promise.all([
    getUser(username).catch(() => null),
    contributions(username).catch(() => []),
    userPRs(username, "is:merged").catch(() => ({ total_count: 0, items: [] })),
  ]);
  const s = streaks(days);
  const recent = days.slice(-7 * 26);
  const weeks: typeof recent[] = [];
  for (let i = 0; i < recent.length; i += 7) weeks.push(recent.slice(i, i + 7));

  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", background: "#08080a", color: "#f6f5f1", padding: 64, fontFamily: "sans-serif" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 28 }}>
          {user && (
            <img src={user.avatar_url} width={120} height={120} style={{ borderRadius: 32 }} alt="" />
          )}
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ fontSize: 64, fontWeight: 800, letterSpacing: -2 }}>{user?.name || username}</div>
            <div style={{ fontSize: 28, color: "#8d8c96" }}>@{username} · open source proof of work</div>
          </div>
        </div>
        <div style={{ display: "flex", gap: 24, marginTop: 48 }}>
          {[
            [merged.total_count, "merged PRs"],
            [s.current, "day streak"],
            [s.total, "contributions"],
          ].map(([n, l]) => (
            <div key={String(l)} style={{ display: "flex", flexDirection: "column", background: "#18181d", borderRadius: 28, padding: "20px 32px" }}>
              <div style={{ fontSize: 56, fontWeight: 800, color: "#d4ff3a" }}>{String(n)}</div>
              <div style={{ fontSize: 22, color: "#8d8c96" }}>{String(l)}</div>
            </div>
          ))}
        </div>
        <div style={{ display: "flex", gap: 5, marginTop: "auto" }}>
          {weeks.map((w, i) => (
            <div key={i} style={{ display: "flex", flexDirection: "column", gap: 5 }}>
              {w.map((d, j) => (
                <div key={j} style={{ width: 16, height: 16, borderRadius: 4, background: LEVEL[d.level] || LEVEL[4] }} />
              ))}
            </div>
          ))}
          <div style={{ display: "flex", marginLeft: "auto", alignSelf: "flex-end", fontSize: 34, fontWeight: 800 }}>
            merge<span style={{ color: "#d4ff3a" }}>mate</span>
          </div>
        </div>
      </div>
    ),
    size,
  );
}
