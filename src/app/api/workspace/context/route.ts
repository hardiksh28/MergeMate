import { codeSearch, gh, getRepo, getTree, rawFile, type Issue } from "@/lib/github";
import { aiJSON, errorResponse } from "@/lib/groq";
import { rankPaths, snippet } from "@/lib/snippets";

type Pick = { files: { path: string; why: string }[]; searchTerms: string[] };
export type Explain = {
  tldr: string;
  whatsBroken: string;
  howItWorks: string[];
  fileMap: { path: string; role: string; importance: "core" | "related" | "context" }[];
  glossary: { term: string; meaning: string }[];
  challenge: string;
};

export async function POST(req: Request) {
  try {
    const { owner, repo, number } = await req.json();
    const full = `${owner}/${repo}`;
    const [issue, comments, r] = await Promise.all([
      gh<Issue>(`/repos/${full}/issues/${number}`, { ttl: 300 }),
      gh<{ user: { login: string }; body: string }[]>(`/repos/${full}/issues/${number}/comments?per_page=8`, { ttl: 300 }),
      getRepo(full),
    ]);
    const tree = await getTree(full, r.default_branch);
    const issueText =
      `#${issue.number} ${issue.title}\n\n${(issue.body || "").slice(0, 3000)}` +
      (comments.length
        ? `\n\nComments:\n${comments.map((c) => `@${c.user.login}: ${c.body.slice(0, 400)}`).join("\n").slice(0, 1600)}`
        : "");
    const candidates = rankPaths(tree.map((t) => t.path), issueText);

    const pick = await aiJSON<Pick>(
      req,
      "You are a senior engineer who quickly finds where an issue lives in an unfamiliar codebase.",
      `Repo: ${full} (${r.language || "unknown"}). ${r.description || ""}\n\nIssue:\n${issueText}\n\nFile paths (subset):\n${candidates.join("\n")}\n\nPick the 1-4 files most likely needing a change or needed to understand the fix (exact paths from the list). Return {"files":[{"path":string,"why":string (max 12 words)}],"searchTerms":string[] (identifiers/strings to grep for, max 8)}`,
      700,
    );
    const valid = new Set(tree.map((t) => t.path));
    let chosen = (pick.files || []).filter((f) => valid.has(f.path)).slice(0, 4);

    // File names alone often miss the real spot. Grep the repo for the AI's search terms and let it re-pick.
    const hits = await codeSearch(full, pick.searchTerms || [], req.headers.get("x-github-token") || undefined);
    const newHits = hits.filter((h) => valid.has(h.path) && !chosen.some((c) => c.path === h.path));
    if (newHits.length) {
      const repick = await aiJSON<Pick>(
        req,
        "You are a senior engineer who quickly finds where an issue lives in an unfamiliar codebase.",
        `Repo: ${full}\n\nIssue:\n${issueText}\n\nFirst guess: ${chosen.map((c) => c.path).join(", ") || "none"}\n\nFiles whose contents match the search terms ${JSON.stringify(pick.searchTerms)} (hit count):\n${hits.slice(0, 40).map((h) => `${h.path} (${h.n})`).join("\n")}\n\nPick the 1-4 files most likely needing the change. Prefer files whose contents matched over name-only guesses. Return {"files":[{"path":string,"why":string (max 12 words)}],"searchTerms":string[]}`,
        700,
      );
      const better = (repick.files || []).filter((f) => valid.has(f.path)).slice(0, 4);
      if (better.length) {
        chosen = better;
        pick.searchTerms = [...new Set([...(pick.searchTerms || []), ...(repick.searchTerms || [])])].slice(0, 10);
      }
    }
    if (!chosen.length) throw new Error("Couldn't locate the relevant files for this issue. Try another one.");

    const files = (
      await Promise.all(
        chosen.map(async (f) => {
          const content = await rawFile(owner, repo, r.default_branch, f.path);
          return content == null ? null : { path: f.path, why: f.why, content: content.slice(0, 80_000) };
        }),
      )
    ).filter(Boolean) as { path: string; why: string; content: string }[];

    const terms = pick.searchTerms || [];
    const code = files
      .map((f) => `--- ${f.path} ---\n${snippet(f.content, terms, files.length > 2 ? 4500 : 7000)}`)
      .join("\n\n");

    const explain = await aiJSON<Explain>(
      req,
      "You are MergeMate, a friendly mentor explaining an unfamiliar codebase to a junior developer. Plain language, short sentences, no fluff. Wrap identifiers in backticks.",
      `Repo: ${full}\nIssue:\n${issueText}\n\nRelevant code:\n${code}\n\nReturn {"tldr": string (what the issue asks, 1-2 sentences), "whatsBroken": string (current behaviour vs expected, 2-3 sentences), "howItWorks": string[] (3-6 steps explaining how this part of the code flows, each 1 sentence), "fileMap": [{"path": string, "role": string (1 sentence), "importance": "core"|"related"|"context"}], "glossary": [{"term": string, "meaning": string}] (max 4 project-specific terms), "challenge": string (one question asking the user where they think the change should go, without giving the answer)}`,
      1800,
    );

    explain.howItWorks = Array.isArray(explain.howItWorks) ? explain.howItWorks : [];
    explain.fileMap = Array.isArray(explain.fileMap) ? explain.fileMap : [];
    explain.glossary = Array.isArray(explain.glossary) ? explain.glossary : [];
    explain.challenge ||= "Where in these files do you think the change should go, and why?";
    explain.tldr ||= issue.title;
    explain.whatsBroken ||= "";

    return Response.json({
      issue: {
        number: issue.number,
        title: issue.title,
        body: issue.body,
        url: issue.html_url,
        author: issue.user.login,
        labels: issue.labels,
        comments: comments.map((c) => ({ user: c.user.login, body: c.body.slice(0, 600) })),
      },
      repo: {
        full,
        branch: r.default_branch,
        stars: r.stargazers_count,
        description: r.description,
        language: r.language,
        avatar: r.owner.avatar_url,
      },
      files,
      searchTerms: terms,
      explain,
      treeSize: tree.length,
    });
  } catch (e) {
    return errorResponse(e);
  }
}
