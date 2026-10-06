import { aiJSON, errorResponse } from "@/lib/groq";
import { snippet } from "@/lib/snippets";

export async function POST(req: Request) {
  try {
    const { issue, files, searchTerms = [], guess } = await req.json();
    const code = (files as { path: string; content: string }[])
      .map((f) => `--- ${f.path} ---\n${snippet(f.content, searchTerms, 3500)}`)
      .join("\n\n");
    const out = await aiJSON<{ verdict: "nailed" | "close" | "off"; feedback: string; nudge: string }>(
      req,
      "You are a supportive coding mentor. Judge a learner's guess about where/how to fix an issue. Be honest but encouraging, Gen-Z friendly tone, no cringe. Never write the full fix.",
      `Issue: ${issue.title}\n${(issue.body || "").slice(0, 1500)}\n\nCode:\n${code}\n\nLearner's guess: """${String(guess).slice(0, 1500)}"""\n\nReturn {"verdict": "nailed"|"close"|"off", "feedback": string (2-3 sentences on what they got right/wrong), "nudge": string (one hint pointing at the exact spot, without the solution)}`,
      600,
    );
    return Response.json(out);
  } catch (e) {
    return errorResponse(e);
  }
}
