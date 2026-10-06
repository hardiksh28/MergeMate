import { contributions, getRepo, getUser, streaks, userLanguages, userPRs, repoFromUrl } from "@/lib/github";
import { aiJSON, errorResponse } from "@/lib/groq";
import { getActivity } from "@/lib/activity";

const summaryCache = new Map<string, string>();

export async function GET(req: Request, ctx: RouteContext<"/api/public/[username]">) {
  try {
    const { username } = await ctx.params;
    const lite = new URL(req.url).searchParams.has("lite");
    const [user, days, merged, open, ownLangs] = await Promise.all([
      getUser(username),
      contributions(username).catch(() => []),
      userPRs(username, "is:merged"),
      userPRs(username, "is:open").catch(() => ({ items: [], total_count: 0 })),
      userLanguages(username).catch(() => []),
    ]);
    const mm = await getActivity(username);
    const mmStreak = streaks(mm.days);

    const repoNames = [...new Set(merged.items.map((p) => repoFromUrl(p.repository_url)))].slice(0, 12);
    const repos = (await Promise.all(repoNames.map((n) => getRepo(n).catch(() => null)))).filter(Boolean);
    const repoMap = new Map(repos.map((r) => [r!.full_name.toLowerCase(), r!]));

    // round-robin across repos so the list shows breadth, not 12 PRs to one project
    const byRepo = new Map<string, typeof merged.items>();
    for (const p of merged.items) {
      const k = repoFromUrl(p.repository_url);
      byRepo.set(k, [...(byRepo.get(k) || []), p]);
    }
    const spread: typeof merged.items = [];
    for (let i = 0; spread.length < merged.items.length; i++) {
      for (const list of byRepo.values()) if (list[i]) spread.push(list[i]);
    }
    const prs = spread.slice(0, 12).map((p) => {
      const full = repoFromUrl(p.repository_url);
      const r = repoMap.get(full.toLowerCase());
      return {
        id: `${full}#${p.number}`,
        repo: full,
        number: p.number,
        title: p.title,
        url: p.html_url,
        mergedAt: p.pull_request?.merged_at || p.closed_at,
        stars: r?.stargazers_count || 0,
        language: r?.language || null,
        avatar: r?.owner.avatar_url || null,
        body: (p.body || "").slice(0, 600),
        summary: summaryCache.get(`${full}#${p.number}`) || "",
      };
    });

    // plain-language summaries (best effort, cached)
    const missing = prs.filter((p) => !p.summary);
    if (missing.length && !lite) {
      try {
        const out = await aiJSON<{ summaries: { id: string; summary: string }[] }>(
          req,
          "You write one-line plain-language summaries of merged pull requests for a recruiter-facing portfolio. Start with a verb. Max 16 words. No hype.",
          `PRs:\n${missing.map((p) => `id=${p.id}\ntitle=${p.title}\nbody=${p.body.slice(0, 400)}`).join("\n---\n")}\n\nReturn {"summaries":[{"id": string, "summary": string}]}`,
          1200,
        );
        for (const s of out.summaries || []) summaryCache.set(s.id, s.summary);
        for (const p of prs) p.summary = summaryCache.get(p.id) || "";
      } catch {}
    }

    const langCount = new Map<string, number>();
    for (const p of prs) if (p.language) langCount.set(p.language, (langCount.get(p.language) || 0) + 1);
    const provenSkills = [...langCount.entries()].sort((a, b) => b[1] - a[1]).map(([name, count]) => ({ name, count }));

    const s = streaks(days);
    const last30 = days.slice(-30).reduce((n, d) => n + d.count, 0);
    return Response.json({
      user: {
        login: user.login,
        name: user.name,
        avatar: user.avatar_url,
        bio: user.bio,
        followers: user.followers,
        since: user.created_at,
        url: user.html_url,
      },
      days,
      stats: {
        ...s,
        last30,
        merged: merged.total_count,
        open: open.total_count,
        repos: new Set(merged.items.map((p) => repoFromUrl(p.repository_url))).size,
        stars: repos.reduce((n, r) => n + (r?.stargazers_count || 0), 0),
      },
      prs,
      provenSkills,
      mergemate: {
        days: mm.days,
        current: mmStreak.current,
        longest: mmStreak.longest,
        activeDays: mm.activeDays,
        actions: mm.actions,
        prs: mm.prs,
        last30: mm.days.slice(-30).filter((d) => d.count > 0).length,
      },
      languages: ownLangs.slice(0, 6),
    });
  } catch (e) {
    return errorResponse(e);
  }
}
