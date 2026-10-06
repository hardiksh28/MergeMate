import { rawFile } from "@/lib/github";
import { aiJSON, errorResponse } from "@/lib/groq";

const GUIDE_PATHS = ["CONTRIBUTING.md", ".github/CONTRIBUTING.md", "docs/CONTRIBUTING.md", "CONTRIBUTING.rst"];
const TEMPLATE_PATHS = [".github/pull_request_template.md", ".github/PULL_REQUEST_TEMPLATE.md", "PULL_REQUEST_TEMPLATE.md"];

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

export async function POST(req: Request) {
  try {
    const { repo, branch, issueNumber, prTitle, prBody, changedPaths, diff } = await req.json();
    const [owner, name] = String(repo).split("/");
    const [guide, template] = await Promise.all([
      firstFound(owner, name, branch, GUIDE_PATHS),
      firstFound(owner, name, branch, TEMPLATE_PATHS),
    ]);
    const cla = await detectCla(owner, name, branch, guide?.text || "");

    const out = await aiJSON<{
      rules: { rule: string; status: "pass" | "warn" | "fail"; note: string }[];
      fixedTitle: string;
      fixedBody: string;
    }>(
      req,
      "You check pull requests against a project's contribution rules before submission. Only flag rules that apply to this PR. Be concrete.",
      `Contribution guide (${guide?.path || "none found, use common open source etiquette"}):\n${(guide?.text || "").slice(0, 6000)}\n\nPR template:\n${(template?.text || "none").slice(0, 1500)}\n\nPR title: ${prTitle}\nPR body:\n${String(prBody).slice(0, 2500)}\nChanged files: ${(changedPaths || []).join(", ")}\nDiff (truncated):\n${String(diff || "").slice(0, 3000)}\nIssue: #${issueNumber}\n\nReturn {"rules": [{"rule": string (short), "status": "pass"|"warn"|"fail", "note": string (what to do, 1 sentence)}] (4-8 items, include commit/title convention, linking the issue, tests, docs/changelog, template sections, scope), "fixedTitle": string (title corrected to follow the rules), "fixedBody": string (body rewritten to satisfy the template/rules, keep content, keep "Fixes #${issueNumber}")}`,
      2500,
    );
    return Response.json({
      guideFound: guide?.path || null,
      templateFound: template?.path || null,
      cla,
      rules: Array.isArray(out.rules) ? out.rules : [],
      fixedTitle: out.fixedTitle || prTitle,
      fixedBody: out.fixedBody || prBody,
    });
  } catch (e) {
    return errorResponse(e);
  }
}
