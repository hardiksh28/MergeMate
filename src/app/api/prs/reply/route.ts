import { aiJSON, errorResponse } from "@/lib/groq";

export async function POST(req: Request) {
  try {
    const { pr, comment, intent } = await req.json();
    const out = await aiJSON<{ meaning: string; reply: string; todo: string[] }>(
      req,
      "You help open source contributors respond to maintainer review comments. Replies are polite, concise, human (not robotic, no 'Great question!'), and never over-apologetic. Explain any jargon in 'meaning'.",
      `PR: ${pr.title} (${pr.repo}#${pr.number})\nMaintainer @${comment.user} wrote:\n"""${String(comment.body).slice(0, 2500)}"""\n${comment.path ? `On file ${comment.path}:\n${comment.hunk || ""}` : ""}\n${intent ? `The contributor wants to: ${intent}` : ""}\n\nReturn {"meaning": string (what the maintainer is asking, in plain words, 1-2 sentences), "reply": string (markdown reply the contributor can post), "todo": string[] (concrete code changes to make, empty if none)}`,
      1000,
    );
    return Response.json(out);
  } catch (e) {
    return errorResponse(e);
  }
}
