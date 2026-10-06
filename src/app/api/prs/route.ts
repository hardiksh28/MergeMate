import { gh, userPRs, repoFromUrl } from "@/lib/github";
import { errorResponse } from "@/lib/groq";

export type PRItem = {
  id: string;
  repo: string;
  number: number;
  title: string;
  url: string;
  status: "open" | "draft" | "merged" | "closed";
  createdAt: string;
  closedAt: string | null;
  comments: number;
  body: string;
};

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const detail = url.searchParams.get("detail"); // owner/repo#123
    if (detail) {
      const [repo, n] = detail.split("#");
      const [issueComments, reviewComments, reviews] = await Promise.all([
        gh<{ user: { login: string }; body: string; created_at: string }[]>(`/repos/${repo}/issues/${n}/comments?per_page=30`),
        gh<{ user: { login: string }; body: string; created_at: string; path: string; diff_hunk: string }[]>(
          `/repos/${repo}/pulls/${n}/comments?per_page=30`,
        ),
        gh<{ user: { login: string }; body: string; state: string; submitted_at: string }[]>(`/repos/${repo}/pulls/${n}/reviews?per_page=30`),
      ]);
      const comments = [
        ...issueComments.map((c) => ({ user: c.user.login, body: c.body, at: c.created_at, kind: "comment" })),
        ...reviewComments.map((c) => ({
          user: c.user.login,
          body: c.body,
          at: c.created_at,
          kind: "review",
          path: c.path,
          hunk: c.diff_hunk?.split("\n").slice(-6).join("\n"),
        })),
        ...reviews
          .filter((r) => r.body)
          .map((r) => ({ user: r.user.login, body: r.body, at: r.submitted_at, kind: r.state.toLowerCase() })),
      ].sort((a, b) => a.at.localeCompare(b.at));
      return Response.json({ comments });
    }

    const username = url.searchParams.get("username");
    if (!username) return Response.json({ error: "username required" }, { status: 400 });
    const { items, total_count } = await userPRs(username);
    const prs: PRItem[] = items.map((p) => ({
      id: `${repoFromUrl(p.repository_url)}#${p.number}`,
      repo: repoFromUrl(p.repository_url),
      number: p.number,
      title: p.title,
      url: p.html_url,
      status: p.pull_request?.merged_at ? "merged" : p.state === "closed" ? "closed" : p.draft ? "draft" : "open",
      createdAt: p.created_at,
      closedAt: p.pull_request?.merged_at || p.closed_at,
      comments: p.comments,
      body: (p.body || "").slice(0, 1500),
    }));
    return Response.json({ prs, total: total_count });
  } catch (e) {
    return errorResponse(e);
  }
}
