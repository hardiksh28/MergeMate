import { rawFile } from "@/lib/github";
import { aiJSON, errorResponse } from "@/lib/groq";
import { TEST_RE } from "@/lib/snippets";

const GUIDE_PATHS = ["CONTRIBUTING.md", ".github/CONTRIBUTING.md", "docs/CONTRIBUTING.md", "CONTRIBUTING.rst"];
const TEMPLATE_PATHS = [
  ".github/pull_request_template.md",
  ".github/PULL_REQUEST_TEMPLATE.md",
  "pull_request_template.md",
  "PULL_REQUEST_TEMPLATE.md",
  "docs/pull_request_template.md",
  ".github/PULL_REQUEST_TEMPLATE/pull_request_template.md",
];
const DCO_RE = /signed-off-by|\bDCO\b|developer certificate of origin|sign[- ]off your commits|git commit -s\b/i;

// Orgs known to gate every PR behind a CLA bot
const KNOWN_CLA: Record<string, string> = {
  elastic: "https://www.elastic.co/contributor-agreement",
  google: "https://cla.developers.google.com/",
  googleapis: "https://cla.developers.google.com/",
  googlecloudplatform: "https://cla.developers.google.com/",
  microsoft: "https://cla.opensource.microsoft.com/",
  azure: "https://cla.opensource.microsoft.com/",
  facebook: "https://code.facebook.com/cla",
  facebookresearch: "https://code.facebook.com/cla",
};
const CLA_RE = /contributor(?:'s)? (?:license )?agreement|\bCLA\b/i;

/** Does this repo require a signed CLA? Looks at the guide, a CLA bot config and known orgs. */
async function detectCla(owner: string, name: string, branch: string, guide: string) {
  const known = KNOWN_CLA[owner.toLowerCase()];
  const inGuide = CLA_RE.test(guide);
  const botConfig = !inGuide && !known ? await rawFile(owner, name, branch, ".clabot") : null;
  if (!known && !inGuide && !botConfig) return { required: false, url: null };
  // prefer a link from the guide that looks like the agreement itself
  const links = guide.match(/https?:\/\/[^\s)>\]"']+/g) || [];
  const url = links.find((l) => /cla|contributor[-_]?(license[-_]?)?agreement/i.test(l)) || known || null;
  return { required: true, url };
}

async function firstFound(owner: string, repo: string, branch: string, paths: string[]) {
  for (const p of paths) {
    const t = await rawFile(owner, repo, branch, p);
    if (t) return { path: p, text: t };
  }
  return null;
}

/** Nearest package.json "name" above a file, for the changeset front matter. */
async function packageFor(owner: string, name: string, branch: string, path: string, cache: Map<string, string | null>) {
  const parts = path.split("/").slice(0, -1);
  for (let i = parts.length; i >= 0; i--) {
    const dir = parts.slice(0, i).join("/");
    if (!cache.has(dir)) {
      const raw = await rawFile(owner, name, branch, `${dir ? dir + "/" : ""}package.json`);
      let pkg: string | null = null;
      try {
        const j = raw ? JSON.parse(raw) : null;
        // a private workspace root isn't a publishable package
        pkg = j?.name && !(j.private && j.workspaces) ? j.name : null;
      } catch {}
      cache.set(dir, raw ? pkg ?? "" : null);
    }
    const hit = cache.get(dir);
    if (hit) return hit;
    if (hit === "") return null; // found a package.json without a usable name: stop here
  }
  return null;
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "change";

type CheckAI = {
  title: string;
  body: string;
  changesetSummary: string;
  bump: "patch" | "minor";
  rules: { rule: string; status: "pass" | "todo" | "warn"; note: string }[];
};

export async function POST(req: Request) {
  try {
    const { repo, branch, issueNumber, issueTitle, prTitle, prBody, changedPaths, diff } = await req.json();
    const [owner, name] = String(repo).split("/");
    const paths: string[] = (changedPaths || []).filter((p: string) => !p.startsWith(".changeset/"));
    const [guide, template, changesetConfig] = await Promise.all([
      firstFound(owner, name, branch, GUIDE_PATHS),
      firstFound(owner, name, branch, TEMPLATE_PATHS),
      rawFile(owner, name, branch, ".changeset/config.json"),
    ]);
    const guideText = guide?.text || "";
    const cla = await detectCla(owner, name, branch, guideText);
    const dco = DCO_RE.test(guideText) || DCO_RE.test(template?.text || "");
    const testsChanged = paths.some((p) => TEST_RE.test(p));

    // Changesets: which packages did this PR touch?
    let packages: string[] = [];
    if (changesetConfig) {
      const cache = new Map<string, string | null>();
      packages = [...new Set((await Promise.all(paths.map((p) => packageFor(owner, name, branch, p, cache)))).filter(Boolean) as string[])];
    }
    const changesetNeeded = !!changesetConfig && packages.length > 0;

    const facts = [
      changesetNeeded ? `MergeMate adds a changeset file for: ${packages.join(", ")}` : changesetConfig ? "Repo uses changesets but no publishable package was touched (no changeset needed)" : "Repo does not use changesets",
      testsChanged ? "The diff adds/updates tests" : "The diff does not include test changes",
      dco ? "Commits will be signed off (Signed-off-by trailer) automatically" : "",
      `Linked issue: #${issueNumber}`,
    ].filter(Boolean);

    const ai = await aiJSON<CheckAI>(
      req,
      `You prepare pull requests so they pass a project's contribution rules on the first try. You are honest: you never claim work that wasn't done.
Rules for the body:
- If a PR template exists, the body MUST use its exact structure: same headings, same order, every checkbox line kept. Remove HTML comments (<!-- -->) from the template.
- Fill every section with real, specific content about this change (no placeholders like "N/A" unless the section truly doesn't apply).
- Tick a checkbox ("- [x]") ONLY if one of the FACTS proves it, or it is the matching "type of change" option. Leave every other box unticked ("- [ ]"); the contributor will confirm those themselves.
- Keep "Fixes #${issueNumber}".
Rules for the title: follow the convention in the guide (e.g. Conventional Commits with a scope) if any.`,
      `Contribution guide (${guide?.path || "none found, use common open source etiquette"}):\n${guideText.slice(0, 6000)}\n\nPR template (${template?.path || "none"}):\n${(template?.text || "none").slice(0, 2500)}\n\nIssue #${issueNumber}: ${issueTitle || ""}\nCurrent PR title: ${prTitle}\nCurrent PR body:\n${String(prBody).slice(0, 2500)}\nChanged files: ${paths.join(", ")}\nDiff (truncated):\n${String(diff || "").slice(0, 3000)}\n\nFACTS:\n- ${facts.join("\n- ")}\n\nReturn {"title": string, "body": string (markdown), "changesetSummary": string (one user-facing changelog line, present tense, no trailing period), "bump": "patch"|"minor" (patch for fixes/docs/refactors, minor for new features; never major), "rules": [{"rule": string (short), "status": "pass"|"todo"|"warn", "note": string (1 sentence)}] (5-9 items covering every requirement in the guide/template that applies, evaluated AFTER your new title/body and the FACTS. "pass" = satisfied, "todo" = needs the contributor to do or confirm something (say exactly what), "warn" = only if it applies)}`,
      3500,
      "medium",
    );

    const bump = ai.bump === "minor" ? "minor" : "patch";
    const summary = (ai.changesetSummary || issueTitle || prTitle || "Fix").trim();
    const changeset = changesetNeeded
      ? {
          path: `.changeset/mergemate-${issueNumber}-${slug(summary)}.md`,
          packages,
          bump,
          summary,
        }
      : null;

    return Response.json({
      guideFound: guide?.path || null,
      templateFound: template?.path || null,
      cla,
      dco,
      testsChanged,
      changeset,
      rules: Array.isArray(ai.rules) ? ai.rules : [],
      fixedTitle: ai.title || prTitle,
      fixedBody: ai.body || prBody,
    });
  } catch (e) {
    return errorResponse(e);
  }
}
