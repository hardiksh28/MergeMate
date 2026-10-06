import { PRIMARY_MODEL } from "@/lib/groq";

export function GET() {
  return Response.json({
    groqServer: !!process.env.GROQ_API_KEY,
    githubServer: !!process.env.GITHUB_TOKEN,
    model: PRIMARY_MODEL,
  });
}
