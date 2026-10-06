// MergeMate activity log (one row per user per day). JSON file for the MVP; move to the DB with accounts.
import { promises as fs } from "fs";
import path from "path";
import type { Day } from "./github";
import { dbConfigured, rpc } from "./db";

// Vercel's filesystem is read-only except /tmp, which is wiped when an instance recycles.
// Fine for a trial; move this to a database before relying on the graph.
const FILE = process.env.VERCEL ? "/tmp/mergemate-activity.json" : path.join(process.cwd(), "data", "activity.json");

// How much each action counts towards the day's square. Opening a PR is the big one.
export const ACTIVITY_WEIGHTS = {
  start: 1, // opened an issue in the workspace
  guess: 1, // checked a guess
  fix: 1, // prepped a fix
  check: 1, // ran the contribution check
  pr: 3, // opened a PR through MergeMate
  prep: 1, // interview prep
  reply: 1, // drafted a review reply
} as const;
export type ActivityKind = keyof typeof ACTIVITY_WEIGHTS;

type Log = Record<string, Record<string, Partial<Record<ActivityKind, number>>>>; // user -> date -> kind -> n

let lock: Promise<unknown> = Promise.resolve();

async function read(): Promise<Log> {
  try {
    return JSON.parse(await fs.readFile(FILE, "utf8"));
  } catch {
    return {};
  }
}

export function recordActivity(username: string, kind: ActivityKind, date = new Date().toISOString().slice(0, 10)) {
  const run = async () => {
    const log = await read();
    const day = ((log[username.toLowerCase()] ||= {})[date] ||= {});
    if ((day[kind] || 0) >= 20) return; // cap so one busy day can't inflate the graph
    day[kind] = (day[kind] || 0) + 1;
    await fs.mkdir(path.dirname(FILE), { recursive: true });
    await fs.writeFile(FILE, JSON.stringify(log));
  };
  const p = lock.then(run, run);
  lock = p.catch(() => {});
  return p;
}

const level = (n: number) => (n === 0 ? 0 : n <= 2 ? 1 : n <= 4 ? 2 : n <= 7 ? 3 : 4);

/** One user's day -> kind -> count map: from the database when configured, else the local file. */
async function userLog(username: string): Promise<Log[string]> {
  if (dbConfigured()) {
    try {
      const rows = await rpc<{ day: string; kind: ActivityKind; n: number }[]>("mm_user_activity", { p_login: username });
      const log: Log[string] = {};
      for (const r of rows || []) (log[r.day] ||= {})[r.kind] = r.n;
      return log;
    } catch (e) {
      console.warn("[activity] db read failed:", (e as Error).message);
      return {};
    }
  }
  return (await read())[username.toLowerCase()] || {};
}

/** Last 53 weeks of MergeMate activity, same shape as the GitHub calendar, plus totals. */
export async function getActivity(username: string) {
  const log = await userLog(username);
  const days: Day[] = [];
  const end = new Date();
  const start = new Date(end);
  start.setDate(start.getDate() - 364 - start.getDay()); // align to a Sunday like GitHub
  let prs = 0;
  let actions = 0;
  for (const d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const key = d.toISOString().slice(0, 10);
    const kinds = log[key] || {};
    const count = (Object.entries(kinds) as [ActivityKind, number][]).reduce((s, [k, n]) => s + n * ACTIVITY_WEIGHTS[k], 0);
    prs += kinds.pr || 0;
    actions += Object.values(kinds).reduce((s, n) => s + (n || 0), 0);
    days.push({ date: key, count, level: level(count) });
  }
  return { days, prs, actions, activeDays: days.filter((d) => d.count > 0).length };
}
