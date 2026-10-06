// Thin Groq client (OpenAI-compatible). Server-only.
const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";

export const PRIMARY_MODEL = process.env.GROQ_MODEL || "openai/gpt-oss-120b";
const FALLBACK_MODEL = process.env.GROQ_FALLBACK_MODEL || "openai/gpt-oss-20b";

export class AIError extends Error {
  status: number;
  retryAfter = 0;
  constructor(message: string, status = 500) {
    super(message);
    this.status = status;
  }
}

/** Resolve the key: server env first, then a key the user pasted in Settings (sent as a header). */
export function groqKey(req: Request): string {
  const key = process.env.GROQ_API_KEY || req.headers.get("x-groq-key") || "";
  if (!key) {
    throw new AIError(
      "No Groq API key yet. Add GROQ_API_KEY to .env.local or paste one in Settings.",
      401,
    );
  }
  return key;
}

type Msg = { role: "system" | "user" | "assistant"; content: string };

type Effort = "low" | "medium" | "high";

async function call(key: string, model: string, messages: Msg[], maxTokens: number, effort: Effort) {
  const res = await fetch(GROQ_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages,
      temperature: 0.3,
      max_completion_tokens: maxTokens,
      response_format: { type: "json_object" },
      // gpt-oss reasons before answering; keep it short so the JSON fits the token budget
      ...(model.startsWith("openai/gpt-oss") ? { reasoning_effort: effort } : {}),
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    const err = new AIError(`Groq ${res.status}: ${text.slice(0, 300)}`, res.status);
    err.retryAfter = Number(res.headers.get("retry-after")) || 0;
    throw err;
  }
  const data = await res.json();
  if (process.env.NODE_ENV !== "production") console.log(`[ai] ${model} ${data.usage?.prompt_tokens}+${data.usage?.completion_tokens} tokens`);
  return data.choices?.[0]?.message?.content as string;
}

/** Ask for a JSON object back. Falls back to a second model on failure. */
export async function aiJSON<T>(
  req: Request,
  system: string,
  user: string,
  maxTokens = 4000,
  effort: Effort = "low",
): Promise<T> {
  const key = groqKey(req);
  const messages: Msg[] = [
    { role: "system", content: `${system}\nRespond with a single valid JSON object only.` },
    { role: "user", content: user },
  ];
  let raw: string;
  try {
    try {
      raw = await call(key, PRIMARY_MODEL, messages, maxTokens, effort);
    } catch (e) {
      // per-minute token limit: a short wait beats dropping to the smaller model
      if (!(e instanceof AIError) || e.status !== 429 || e.retryAfter > 20) throw e;
      await new Promise((r) => setTimeout(r, (e.retryAfter || 3) * 1000 + 250));
      raw = await call(key, PRIMARY_MODEL, messages, maxTokens, effort);
    }
  } catch (e) {
    if (e instanceof AIError && e.status === 401) throw new AIError("Groq rejected the API key.", 401);
    console.warn(`[ai] ${PRIMARY_MODEL} failed, using ${FALLBACK_MODEL}:`, (e as Error).message.slice(0, 160));
    raw = await call(key, FALLBACK_MODEL, messages, maxTokens, effort);
  }
  try {
    return JSON.parse(raw) as T;
  } catch {
    const m = raw?.match(/\{[\s\S]*\}/);
    if (m) return JSON.parse(m[0]) as T;
    throw new AIError("The AI returned something unreadable. Try again.");
  }
}

export function errorResponse(e: unknown) {
  const status = e instanceof AIError ? e.status : (e as { status?: number })?.status || 500;
  const message = e instanceof Error ? e.message : "Something went wrong";
  return Response.json({ error: message }, { status: status >= 400 && status < 600 ? status : 500 });
}
