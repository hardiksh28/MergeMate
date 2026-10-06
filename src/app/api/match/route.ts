import { gh, getRepo, userLanguages, repoFromUrl, type Issue, type Repo } from "@/lib/github";
import { errorResponse } from "@/lib/groq";

export type Match = {
  id: string;
  owner: string;
  repo: string;
  number: number;
  title: string;
  url: string;
  labels: { name: string; color: string }[];
  language: string;
  difficulty: "Easy" | "Medium" | "Spicy";
  minutes: number;
  score: number;
  reasons: string[];
  repoInfo: { stars: number; description: string | null; avatar: string; pushedDaysAgo: number };
  createdAt: string;
  comments: number;
};

const DAY = 86_400_000;

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const username = url.searchParams.get("username")?.trim();
    const level = url.searchParams.get("level") || "beginner";
    const limit = Math.min(Number(url.searchParams.get("limit") || 12), 30);
    const skills = (url.searchParams.get("skills") || "")
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
    let langs = (url.searchParams.get("langs") || "").split(",").map((s) => s.trim()).filter(Boolean);
    if (!langs.length && username) langs = (await userLanguages(username)).slice(0, 3);
    if (!langs.length) langs = ["TypeScript", "Python"];
    langs = langs.slice(0, 3);

    const since = new Date(Date.now() - 120 * DAY).toISOString().slice(0, 10);
    const label = level === "beginner" ? 'label:"good first issue"' : 'label:"help wanted"';
    const results = await Promise.allSettled(
      langs.map((lang) =>
        gh<{ items: Issue[] }>(
          `/search/issues?q=${encodeURIComponent(
            `${label} state:open no:assignee is:issue archived:false language:"${lang}" created:>${since} comments:<12`,
          )}&sort=updated&order=desc&per_page=25`,
          { ttl: 900 },
        ).then((r) => r.items.map((i) => ({ ...i, _lang: lang }))),
      ),
    );
    const failed = results.find((r) => r.status === "rejected") as PromiseRejectedResult | undefined;
    let issues = results.flatMap((r) => (r.status === "fulfilled" ? r.value : []));
    if (!issues.length && failed) throw failed.reason;

    // one issue per repo keeps the feed varied
    const seen = new Set<string>();
    issues = issues.filter((i) => {
      const k = repoFromUrl(i.repository_url);
      if (seen.has(k) || i.pull_request) return false;
      seen.add(k);
      return true;
    });

    const repoNames = issues.slice(0, 16).map((i) => repoFromUrl(i.repository_url));
    const repos = new Map<string, Repo>();
    await Promise.all(
      repoNames.map(async (n) => {
        try {
          repos.set(n, await getRepo(n));
        } catch {}
      }),
    );

    const matches: Match[] = [];
    for (const i of issues) {
      const full = repoFromUrl(i.repository_url);
      const r = repos.get(full);
      if (!r || r.archived) continue;
      const pushedDaysAgo = Math.floor((Date.now() - new Date(r.pushed_at).getTime()) / DAY);
      if (pushedDaysAgo > 45 || r.stargazers_count < 15) continue; // skip abandoned / toy repos

      const reasons: string[] = [];
      const lang = (i as Issue & { _lang: string })._lang;
      const langRank = langs.indexOf(lang);
      let score = 60 - langRank * 8;
      reasons.push(langRank === 0 ? `${lang} is your main language` : `You've shipped ${lang} before`);
      if (pushedDaysAgo <= 7) {
        score += 12;
        reasons.push("Maintainers active this week");
      } else score += 5;
      if (r.stargazers_count > 1000) {
        score += 8;
        reasons.push(`${fmt(r.stargazers_count)}★ repo, looks great on a resume`);
      } else if (r.stargazers_count > 100) score += 4;
      if (i.comments === 0) {
        score += 6;
        reasons.push("Nobody's on it yet");
      }
      const text = `${i.title} ${i.body || ""}`.toLowerCase();
      const hit = skills.filter((s) => s.length > 2 && text.includes(s)).slice(0, 2);
      if (hit.length) {
        score += 8 * hit.length;
        reasons.push(`Uses ${hit.join(" + ")} from your resume`);
      }
      const bodyLen = (i.body || "").length;
      const labelNames = i.labels.map((l) => l.name.toLowerCase());
      const easy = labelNames.some((l) => /good first|beginner|easy|starter|docs|documentation/.test(l));
      const difficulty: Match["difficulty"] = easy && bodyLen < 1500 ? "Easy" : bodyLen < 2500 ? "Medium" : "Spicy";
      if (level === "beginner" && difficulty === "Easy") score += 6;
      matches.push({
        id: `${full}#${i.number}`,
        owner: full.split("/")[0],
        repo: full.split("/")[1],
        number: i.number,
        title: i.title,
        url: i.html_url,
        labels: i.labels.slice(0, 4).map((l) => ({ name: l.name, color: l.color })),
        language: lang,
        difficulty,
        minutes: difficulty === "Easy" ? 30 : difficulty === "Medium" ? 90 : 180,
        score: Math.min(99, score),
        reasons: reasons.slice(0, 3),
        repoInfo: {
          stars: r.stargazers_count,
          description: r.description,
          avatar: r.owner.avatar_url,
          pushedDaysAgo,
        },
        createdAt: i.created_at,
        comments: i.comments,
      });
    }
    matches.sort((a, b) => b.score - a.score);
    return Response.json({ langs, matches: matches.slice(0, limit) });
  } catch (e) {
    return errorResponse(e);
  }
}

function fmt(n: number) {
  return n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : String(n);
}
