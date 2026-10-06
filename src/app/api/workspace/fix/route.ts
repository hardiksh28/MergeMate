import { aiJSON, errorResponse } from "@/lib/groq";
import { applyEdits, snippet } from "@/lib/snippets";

type FixAI = {
  rootCause: string;
  steps: { title: string; detail: string }[];
  edits: { path: string; find: string; replace: string }[];
  whyItWorks: string;
  testPlan: string[];
  prTitle: string;
  prBody: string;
  confidence: "high" | "medium" | "low";
};

export async function POST(req: Request) {
  try {
    const { issue, repo, files, searchTerms = [], guess, tweak } = await req.json();
    const fileList = files as { path: string; content: string }[];
    const code = fileList
      .map((f) => `--- ${f.path} ---\n${snippet(f.content, searchTerms, fileList.length > 2 ? 4500 : 7000)}`)
      .join("\n\n");

    const ai = await aiJSON<FixAI>(
      req,
      `You are MergeMate, pairing with a developer on an open source fix. Produce the smallest correct change that a maintainer would happily merge. Match the project's existing code style exactly. Never touch unrelated code.
Edits are search/replace blocks: "find" must be copied EXACTLY (including indentation) from the code shown, long enough to be unique (2-6 lines), and "replace" is the new text. Do not include "/* ... */" markers in find.`,
      `Repo: ${repo}\nIssue #${issue.number}: ${issue.title}\n${(issue.body || "").slice(0, 2500)}\n\n${guess ? `The developer thinks: """${String(guess).slice(0, 800)}"""\n` : ""}${tweak ? `Developer feedback on the previous draft: """${String(tweak).slice(0, 600)}"""\n` : ""}\nCode:\n${code}\n\nReturn {"rootCause": string (2 sentences, plain language), "steps": [{"title": string, "detail": string}] (2-5 steps describing the fix so the developer learns), "edits": [{"path": string, "find": string, "replace": string}], "whyItWorks": string (2-3 sentences), "testPlan": string[] (2-4 ways to verify), "prTitle": string (conventional, concise), "prBody": string (markdown: Summary, Changes, How to test; end with "Fixes #${issue.number}"), "confidence": "high"|"medium"|"low"}`,
      7000,
      "medium",
    );

    const byPath = new Map(fileList.map((f) => [f.path, f.content]));
    const changes: { path: string; original: string; updated: string }[] = [];
    const failed: string[] = [];
    const grouped = new Map<string, { find: string; replace: string }[]>();
    for (const e of ai.edits || []) {
      if (!grouped.has(e.path)) grouped.set(e.path, []);
      grouped.get(e.path)!.push(e);
    }
    for (const [path, edits] of grouped) {
      const original = byPath.get(path);
      if (original == null) {
        failed.push(`${path} (file not loaded)`);
        continue;
      }
      const r = applyEdits(original, edits);
      failed.push(...r.failed.map((f) => `${path}: ${f}`));
      if (r.updated !== original) changes.push({ path, original, updated: r.updated });
    }

    return Response.json({
      rootCause: ai.rootCause || "",
      steps: Array.isArray(ai.steps) ? ai.steps : [],
      whyItWorks: ai.whyItWorks || "",
      testPlan: Array.isArray(ai.testPlan) ? ai.testPlan : [],
      prTitle: ai.prTitle || `Fix #${issue.number}: ${issue.title}`,
      prBody: ai.prBody || `Fixes #${issue.number}`,
      confidence: ai.confidence || "low",
      changes,
      failed,
    });
  } catch (e) {
    return errorResponse(e);
  }
}
