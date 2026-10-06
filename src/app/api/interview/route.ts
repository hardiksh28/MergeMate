import { gh } from "@/lib/github";
import { aiJSON, errorResponse } from "@/lib/groq";

export type Prep = {
  pitch: string;
  star: { situation: string; task: string; action: string; result: string };
  questions: { q: string; answer: string }[];
  skills: string[];
};

export async function POST(req: Request) {
  try {
    const { repo, number, title, body } = await req.json();
    let diff = "";
    try {
      const files = await gh<{ filename: string; patch?: string; additions: number; deletions: number }[]>(
        `/repos/${repo}/pulls/${number}/files?per_page=20`,
        { ttl: 3600 },
      );
      diff = files.map((f) => `${f.filename} (+${f.additions}/-${f.deletions})\n${(f.patch || "").slice(0, 1500)}`).join("\n\n");
    } catch {}
    const out = await aiJSON<Prep>(
      req,
      "You are a tech interview coach. Help a developer explain their open source PR confidently in interviews. Be specific to the actual change. No buzzword soup.",
      `Repo: ${repo}\nPR #${number}: ${title}\n${String(body || "").slice(0, 1500)}\n\nDiff:\n${diff.slice(0, 5000)}\n\nReturn {"pitch": string (30-second spoken explanation, first person, casual-confident), "star": {"situation": string, "task": string, "action": string, "result": string}, "questions": [{"q": string, "answer": string (model answer, 2-4 sentences, first person)}] (4 questions an interviewer would ask about this PR: technical tradeoffs, debugging, testing, collaboration), "skills": string[] (skills this PR proves, max 5)}`,
      2000,
    );
    return Response.json(out);
  } catch (e) {
    return errorResponse(e);
  }
}
