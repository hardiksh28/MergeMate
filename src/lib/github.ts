// GitHub helpers. Server-only. Uses GITHUB_TOKEN when present (5000 req/h vs 60 req/h).
const API = "https://api.github.com";

export class GHError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

const cache = new Map<string, { at: number; data: unknown }>();

// GitHub's secondary rate limit punishes bursts, not volume. Keep at most 6 calls in flight and
// space search calls ~400ms apart (search has its own, much stricter budget).
const MAX_PARALLEL = 6;
let active = 0;
const waiting: (() => void)[] = [];
async function slot<T>(fn: () => Promise<T>): Promise<T> {
  if (active >= MAX_PARALLEL) await new Promise<void>((r) => waiting.push(r));
  active++;
  try {
    return await fn();
  } finally {
    active--;
    waiting.shift()?.();
  }
}
let searchChain: Promise<unknown> = Promise.resolve();
function spaced<T>(fn: () => Promise<T>): Promise<T> {
  const run = searchChain.then(fn, fn);
  searchChain = run.catch(() => {}).then(() => new Promise((r) => setTimeout(r, 400)));
  return run;
}

async function request(url: string, method: string, body: unknown, authToken?: string) {
  return fetch(url, {
    method,
    headers: {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "MergeMate",
      ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    cache: "no-store",
  });
}

export async function gh<T>(
  path: string,
  opts: { token?: string; method?: string; body?: unknown; ttl?: number } = {},
): Promise<T> {
  const { token, method = "GET", body, ttl = 0 } = opts;
  const authToken = token || process.env.GITHUB_TOKEN;
  const cacheKey = method === "GET" && !token ? path : "";
  if (cacheKey && ttl) {
    const hit = cache.get(cacheKey);
    if (hit && Date.now() - hit.at < ttl * 1000) return hit.data as T;
  }
  const url = path.startsWith("http") ? path : API + path;
  const isSearch = path.startsWith("/search/");
  const send = (t?: string) => slot(() => request(url, method, body, t));
  let res = await (isSearch ? spaced(() => send(authToken)) : send(authToken));

  // Server token throttled on a read: one anonymous retry (separate per-IP budget). Never for a user's own token.
  if (res.status === 403 && method === "GET" && authToken && !token) {
    const peek = await res.clone().text();
    if (/secondary rate limit|rate limit/i.test(peek)) res = await (isSearch ? spaced(() => send()) : send());
  }

  if (!res.ok) {
    const text = await res.text();
    let msg = text.slice(0, 200);
    try {
      msg = JSON.parse(text).message || msg;
    } catch {}
    if ((res.status === 403 || res.status === 429) && /secondary rate limit/i.test(msg)) {
      msg = "GitHub is throttling requests for a moment. Try again in a minute or two.";
    } else if ((res.status === 403 || res.status === 429) && /rate limit/i.test(msg)) {
      msg = authToken
        ? "GitHub's hourly limit is used up. It resets within the hour."
        : "GitHub rate limit hit. Add GITHUB_TOKEN to .env.local to get 5000 requests/hour.";
    }
    throw new GHError(`GitHub: ${msg}`, res.status);
  }
  const data = res.status === 204 ? (null as T) : ((await res.json()) as T);
  if (cacheKey && ttl) cache.set(cacheKey, { at: Date.now(), data });
  return data;
}

/** raw.githubusercontent.com does not count against the API rate limit. */
export async function rawFile(owner: string, repo: string, ref: string, path: string) {
  const res = await fetch(`https://raw.githubusercontent.com/${owner}/${repo}/${ref}/${path}`, {
    cache: "no-store",
  });
  if (!res.ok) return null;
  return res.text();
}

export type Repo = {
  full_name: string;
  name: string;
  owner: { login: string; avatar_url: string };
  description: string | null;
  stargazers_count: number;
  forks_count: number;
  open_issues_count: number;
  pushed_at: string;
  language: string | null;
  default_branch: string;
  archived: boolean;
  html_url: string;
  topics?: string[];
};

export type Issue = {
  number: number;
  title: string;
  body: string | null;
  html_url: string;
  repository_url: string;
  created_at: string;
  updated_at: string;
  comments: number;
  labels: { name: string; color: string }[];
  user: { login: string };
  pull_request?: unknown;
  assignee: unknown;
};

export const getRepo = (full: string) => gh<Repo>(`/repos/${full}`, { ttl: 600 });

export async function getTree(full: string, branch: string) {
  const t = await gh<{ tree: { path: string; type: string; size?: number }[]; truncated: boolean }>(
    `/repos/${full}/git/trees/${encodeURIComponent(branch)}?recursive=1`,
    { ttl: 600 },
  );
  return t.tree.filter((n) => n.type === "blob").map((n) => ({ path: n.path, size: n.size || 0 }));
}

export async function getUser(username: string) {
  return gh<{
    login: string;
    name: string | null;
    avatar_url: string;
    bio: string | null;
    public_repos: number;
    followers: number;
    html_url: string;
    created_at: string;
  }>(`/users/${encodeURIComponent(username)}`, { ttl: 600 });
}

/** Top languages across a user's own (non-fork) repos, weighted by recency. */
export async function userLanguages(username: string) {
  const repos = await gh<Repo[] & { fork?: boolean }[]>(
    `/users/${encodeURIComponent(username)}/repos?per_page=100&sort=pushed`,
    { ttl: 600 },
  );
  const score = new Map<string, number>();
  repos.forEach((r, i) => {
    if (!r.language || (r as { fork?: boolean }).fork) return;
    score.set(r.language, (score.get(r.language) || 0) + Math.max(1, 10 - i / 5));
  });
  return [...score.entries()].sort((a, b) => b[1] - a[1]).map(([l]) => l);
}

export type Day = { date: string; count: number; level: number };

/** Scrapes the public contribution calendar (same data as the green map on a profile). */
export async function contributions(username: string): Promise<Day[]> {
  const hit = cache.get("contrib:" + username);
  if (hit && Date.now() - hit.at < 600_000) return hit.data as Day[];
  const res = await fetch(`https://github.com/users/${encodeURIComponent(username)}/contributions`, {
    headers: { "User-Agent": "MergeMate" },
    cache: "no-store",
  });
  if (!res.ok) throw new GHError("Could not load contribution graph", res.status);
  const html = await res.text();
  const cells = new Map<string, { date: string; level: number }>();
  for (const m of html.matchAll(/<td[^>]*data-date="([\d-]+)"[^>]*id="([^"]+)"[^>]*data-level="(\d)"/g)) {
    cells.set(m[2], { date: m[1], level: Number(m[3]) });
  }
  const counts = new Map<string, number>();
  for (const m of html.matchAll(/<tool-tip[^>]*for="([^"]+)"[^>]*>([^<]*)<\/tool-tip>/g)) {
    const n = m[2].match(/^(\d+)/);
    counts.set(m[1], n ? Number(n[1]) : 0);
  }
  const days = [...cells.entries()]
    .map(([id, c]) => ({ date: c.date, level: c.level, count: counts.get(id) ?? (c.level ? 1 : 0) }))
    .sort((a, b) => a.date.localeCompare(b.date));
  cache.set("contrib:" + username, { at: Date.now(), data: days });
  return days;
}

export function streaks(days: Day[]) {
  let current = 0;
  let longest = 0;
  let run = 0;
  for (const d of days) {
    run = d.count > 0 ? run + 1 : 0;
    longest = Math.max(longest, run);
  }
  // current streak: count back from today (today allowed to be empty so far)
  const rev = [...days].reverse();
  const today = new Date().toISOString().slice(0, 10);
  let i = rev[0]?.date === today && rev[0].count === 0 ? 1 : 0;
  for (; i < rev.length && rev[i].count > 0; i++) current++;
  const total = days.reduce((s, d) => s + d.count, 0);
  return { current, longest, total };
}

export type SearchPR = {
  number: number;
  title: string;
  html_url: string;
  state: string;
  created_at: string;
  closed_at: string | null;
  repository_url: string;
  comments: number;
  draft?: boolean;
  body: string | null;
  pull_request?: { merged_at: string | null };
};

export async function userPRs(username: string, extra = "") {
  const q = encodeURIComponent(`author:${username} type:pr -user:${username} ${extra}`.trim());
  const r = await gh<{ items: SearchPR[]; total_count: number }>(
    `/search/issues?q=${q}&sort=created&order=desc&per_page=30`,
    { ttl: 300 },
  );
  return r;
}

/** Paths in a repo whose contents mention any of the terms, most hits first. Needs a token (GitHub rule). */
export async function codeSearch(full: string, terms: string[], token?: string) {
  if (!token && !process.env.GITHUB_TOKEN) return [];
  const hits = new Map<string, number>();
  await Promise.all(
    terms.slice(0, 3).map(async (t) => {
      try {
        const r = await gh<{ items: { path: string }[] }>(
          `/search/code?q=${encodeURIComponent(`"${t.replace(/"/g, "")}" repo:${full}`)}&per_page=15`,
          { token, ttl: 900 },
        );
        for (const i of r.items) hits.set(i.path, (hits.get(i.path) || 0) + 1);
      } catch {}
    }),
  );
  return [...hits.entries()].sort((a, b) => b[1] - a[1]).map(([path, n]) => ({ path, n }));
}

export const repoFromUrl = (url: string) => url.replace("https://api.github.com/repos/", "");
