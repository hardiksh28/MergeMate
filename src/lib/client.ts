"use client";
// Browser-side state. MVP keeps user state in localStorage; move to a DB + GitHub OAuth for prod.
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { FREE_ISSUES_PER_MONTH } from "./pricing";

export type Profile = {
  username: string;
  name: string | null;
  avatar: string;
  headline: string;
  languages: string[];
  skills: string[];
  level: "beginner" | "intermediate";
  weeklyGoal: number;
  createdAt: string;
};

export type Keys = { groq: string; github: string };

const K = {
  profile: "mm.profile",
  keys: "mm.keys",
  usage: "mm.usage",
  started: "mm.started",
  prep: "mm.prep",
  submitted: "mm.submitted",
};

function read<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return v ? (JSON.parse(v) as T) : fallback;
  } catch {
    return fallback;
  }
}
function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    window.dispatchEvent(new Event("mm-store"));
  } catch {}
}

const snapCache = new Map<string, { raw: string | null; value: unknown }>();
function snapshot<T>(key: string, fallback: T): T {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(key);
  } catch {}
  const hit = snapCache.get(key);
  if (hit && hit.raw === raw) return hit.value as T;
  let value: T = fallback;
  try {
    value = raw ? (JSON.parse(raw) as T) : fallback;
  } catch {}
  snapCache.set(key, { raw, value });
  return value;
}
function subscribe(cb: () => void) {
  window.addEventListener("mm-store", cb);
  window.addEventListener("storage", cb);
  return () => {
    window.removeEventListener("mm-store", cb);
    window.removeEventListener("storage", cb);
  };
}
const noopSubscribe = () => () => {};

export function useLocal<T>(key: keyof typeof K, fallback: T) {
  const [serverFallback] = useState(fallback);
  const value = useSyncExternalStore(
    subscribe,
    () => snapshot(K[key], serverFallback),
    () => serverFallback,
  );
  const ready = useSyncExternalStore(noopSubscribe, () => true, () => false);
  const set = useCallback(
    (v: T | ((prev: T) => T)) => {
      const next = typeof v === "function" ? (v as (p: T) => T)(read(K[key], serverFallback)) : v;
      write(K[key], next);
    },
    [key, serverFallback],
  );
  return [value, set, ready] as const;
}

/** Fire-and-forget: adds a square to the user's MergeMate activity graph. */
export function logActivity(kind: "start" | "guess" | "fix" | "check" | "pr" | "prep" | "reply") {
  // the server attributes it to the signed-in GitHub account; ignored when signed out
  fetch("/api/activity", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ kind }),
  }).catch(() => {});
}

export type SessionUser = { login: string; name: string | null; avatar: string };
type Me = { configured: boolean; user: SessionUser | null };
let meCache: Promise<Me> | null = null;
const meListeners = new Set<() => void>();

/** Signed-in GitHub user (null when signed out). `ready` is false until the first check finishes. */
export function useSession() {
  const [me, setMe] = useState<Me | null>(null);
  useEffect(() => {
    let live = true;
    const load = () => {
      meCache ||= fetch("/api/auth/me").then((r) => r.json()).catch(() => ({ configured: false, user: null }));
      meCache.then((m) => live && setMe(m));
    };
    load();
    meListeners.add(load);
    return () => {
      live = false;
      meListeners.delete(load);
    };
  }, []);
  return { user: me?.user ?? null, configured: me?.configured ?? false, ready: me !== null };
}

export async function signOut() {
  await fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
  meCache = null;
  meListeners.forEach((l) => l());
}

export const signInHref = (next = "/app") => `/api/auth/login?next=${encodeURIComponent(next)}`;

export const getKeys = () => read<Keys>(K.keys, { groq: "", github: "" });

/** fetch wrapper that forwards the user's own keys and surfaces API errors as Error */
export async function api<T>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const keys = getKeys();
  const headers: Record<string, string> = { ...(init.headers as Record<string, string>) };
  if (keys.groq) headers["x-groq-key"] = keys.groq;
  if (keys.github) headers["x-github-token"] = keys.github;
  let body = init.body;
  if (init.json !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(init.json);
  }
  const res = await fetch(path, { ...init, headers, body });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data as T;
}

// --- free tier usage ---
const month = () => new Date().toISOString().slice(0, 7);
export function usage() {
  const u = read<{ month: string; ids: string[] }>(K.usage, { month: month(), ids: [] });
  return u.month === month() ? u : { month: month(), ids: [] };
}
export function canStart(id: string) {
  const u = usage();
  return u.ids.includes(id) || u.ids.length < FREE_ISSUES_PER_MONTH;
}
export function markStarted(id: string, meta: { title: string; repo: string }) {
  const u = usage();
  if (!u.ids.includes(id)) write(K.usage, { month: u.month, ids: [...u.ids, id] });
  const started = read<Record<string, { title: string; repo: string; at: string; stage: string }>>(K.started, {});
  if (!started[id]) {
    started[id] = { ...meta, at: new Date().toISOString(), stage: "understand" };
    write(K.started, started);
  }
}
export function setStage(id: string, stage: string) {
  const started = read<Record<string, { stage: string }>>(K.started, {});
  if (started[id]) {
    started[id].stage = stage;
    write(K.started, started);
  }
}

export function timeAgo(iso: string) {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return "just now";
  const units: [number, string][] = [
    [31536000, "y"],
    [2592000, "mo"],
    [604800, "w"],
    [86400, "d"],
    [3600, "h"],
    [60, "m"],
  ];
  for (const [n, u] of units) if (s >= n) return `${Math.floor(s / n)}${u} ago`;
  return "now";
}

export const compact = (n: number) =>
  n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1).replace(/\.0$/, "")}k` : String(n);
