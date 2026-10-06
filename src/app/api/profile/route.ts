import { getUser, userLanguages } from "@/lib/github";
import { aiJSON, errorResponse } from "@/lib/groq";

const KNOWN = [
  "react", "next.js", "vue", "svelte", "angular", "node", "express", "django", "flask", "fastapi",
  "rails", "spring", "go", "rust", "python", "typescript", "javascript", "java", "kotlin", "swift",
  "c++", "c#", "php", "graphql", "rest", "docker", "kubernetes", "aws", "postgres", "mongodb",
  "redis", "tailwind", "css", "html", "testing", "jest", "pytest", "cli", "machine learning",
  "pytorch", "tensorflow", "pandas", "sql", "git", "linux", "flutter", "react native", "solidity",
];

type ResumeAI = { skills: string[]; languages: string[]; experienceLevel: string; headline: string };

// Accepts multipart form: username, resume (file, optional), resumeText (optional)
export async function POST(req: Request) {
  try {
    const form = await req.formData();
    const username = String(form.get("username") || "").trim().replace(/^@/, "");
    if (!username) return Response.json({ error: "GitHub username required" }, { status: 400 });

    let resumeText = String(form.get("resumeText") || "");
    const file = form.get("resume");
    if (file && typeof file !== "string" && file.size > 0) {
      if (file.name.toLowerCase().endsWith(".pdf")) {
        const { extractText, getDocumentProxy } = await import("unpdf");
        const pdf = await getDocumentProxy(new Uint8Array(await file.arrayBuffer()));
        const { text } = await extractText(pdf, { mergePages: true });
        resumeText = text;
      } else {
        resumeText = await file.text();
      }
    }

    const [user, languages] = await Promise.all([getUser(username), userLanguages(username)]);

    let resume: ResumeAI | null = null;
    let aiError: string | null = null;
    if (resumeText.trim().length > 40) {
      try {
        resume = await aiJSON<ResumeAI>(
          req,
          "You extract developer skills from resumes for an open source matching engine.",
          `Resume:\n"""${resumeText.slice(0, 12000)}"""\n\nReturn {"skills": string[] (max 15 concrete tech skills, lowercase, e.g. "react","postgres"), "languages": string[] (programming languages, GitHub linguist names like "TypeScript"), "experienceLevel": "beginner"|"intermediate"|"advanced", "headline": string (one punchy line, max 10 words, describing them as a dev)}`,
          800,
        );
      } catch (e) {
        aiError = e instanceof Error ? e.message : "AI failed";
        const lower = resumeText.toLowerCase();
        resume = {
          skills: KNOWN.filter((k) => lower.includes(k)).slice(0, 15),
          languages: [],
          experienceLevel: "beginner",
          headline: "",
        };
      }
    }

    return Response.json({
      user: {
        login: user.login,
        name: user.name,
        avatar: user.avatar_url,
        bio: user.bio,
        repos: user.public_repos,
        followers: user.followers,
      },
      languages: [...new Set([...(resume?.languages || []), ...languages])].slice(0, 8),
      skills: resume?.skills || [],
      experienceLevel: resume?.experienceLevel || null,
      headline: resume?.headline || user.bio || "",
      aiError,
    });
  } catch (e) {
    return errorResponse(e);
  }
}
