/**
 * MergeMate Groq Client
 * Minimal wrapper around Groq's OpenAI-compatible chat completions endpoint.
 * Used as a fallback text-generation provider when Gemini is unavailable
 * across every configured key and model (e.g. free-tier daily quota
 * exhausted). No SDK dependency — Groq's API is a plain REST endpoint.
 */

const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';

// Groq's model catalog turns over just as fast as Gemini's — verify against
// GET https://api.groq.com/openai/v1/models if these ever start 404ing.
// Prefer general-purpose, non-safety/non-audio models suited to code JSON.
const GROQ_MODEL_CANDIDATES = ['openai/gpt-oss-120b', 'openai/gpt-oss-20b', 'qwen/qwen3.8-27b'];

export function isGroqConfigured(): boolean {
  const key = process.env.GROQ_API_KEY;
  return Boolean(key && key.trim() && !key.includes('your_groq_key'));
}

async function callGroqModel(apiKey: string, model: string, prompt: string): Promise<string> {
  const res = await fetch(GROQ_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.2,
    }),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Groq API error (${res.status}): ${errText.slice(0, 300)}`);
  }

  const data = await res.json();
  const text = data?.choices?.[0]?.message?.content;
  if (typeof text !== 'string' || !text.trim()) {
    throw new Error('Groq API returned an empty response.');
  }
  return text;
}

/**
 * Sends a single-turn prompt to Groq and returns the raw text response,
 * trying a short list of current models in order. Throws on any failure
 * (missing key, network, auth, every model unavailable, empty response) so
 * callers can decide whether to fall back further or surface the error —
 * mirrors the contract of Gemini's model.generateContent().
 */
export async function generateWithGroq(prompt: string, model?: string): Promise<string> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey || !isGroqConfigured()) {
    throw new Error('GROQ_API_KEY is not configured.');
  }

  const candidates = model ? [model] : GROQ_MODEL_CANDIDATES;
  let lastError: any = null;

  for (const modelName of candidates) {
    try {
      return await callGroqModel(apiKey, modelName, prompt);
    } catch (err: any) {
      lastError = err;
      const message = String(err?.message || err);
      // Move to the next candidate only for "model unavailable" style
      // errors; anything else (auth, bad request) won't be fixed by
      // switching models, so surface it immediately.
      if (!/404|model_not_found|does not exist|not found|decommissioned/i.test(message)) throw err;
    }
  }

  throw lastError || new Error('All Groq model candidates are unavailable.');
}
