"use client";
import { ArrowRight, ExternalLink, FileText, RefreshCw, ShieldCheck, Sparkles, Undo2 } from "lucide-react";
import { Rich } from "./ui";
import { parseCheckboxes, toggleCheckbox, type Changeset } from "@/lib/pr";

export type CheckResult = {
  guideFound: string | null;
  templateFound: string | null;
  cla?: { required: boolean; url: string | null };
  dco?: boolean;
  testsChanged?: boolean;
  changeset?: { path: string; packages: string[]; bump: "patch" | "minor"; summary: string } | null;
  rules: { rule: string; status: "pass" | "todo" | "warn" | "fail"; note: string }[];
  fixedTitle: string;
  fixedBody: string;
};

const ICON = { pass: "✅", todo: "👉", warn: "⚠️", fail: "👉" } as const;

export function CheckStage({
  check,
  title,
  body,
  changeset,
  canUndo,
  busy,
  onTitle,
  onBody,
  onChangeset,
  onUndo,
  onRecheck,
  onNext,
}: {
  check: CheckResult;
  title: string;
  body: string;
  changeset: Changeset | null;
  canUndo: boolean;
  busy: string;
  onTitle: (v: string) => void;
  onBody: (v: string) => void;
  onChangeset: (c: Changeset) => void;
  onUndo: () => void;
  onRecheck: () => void;
  onNext: () => void;
}) {
  const boxes = parseCheckboxes(body);
  const ticked = boxes.filter((b) => b.checked).length;
  const rules = check.rules;
  const passed = rules.filter((r) => r.status === "pass").length;
  const todo = rules.filter((r) => r.status === "todo" || r.status === "fail");

  const autoFixes = [
    check.templateFound && `Rewrote the PR to follow ${check.templateFound}`,
    !check.templateFound && check.guideFound && `Rewrote the title and body to follow ${check.guideFound}`,
    changeset?.include && `Added a changeset for ${changeset.packages.join(", ")}`,
    check.testsChanged && "Your change includes a test",
    check.dco && "Commits will be signed off (DCO) automatically",
  ].filter(Boolean) as string[];

  return (
    <section className="animate-rise space-y-5">
      <div className="card p-6">
        <div className="flex items-center gap-2 text-sky"><ShieldCheck className="h-5 w-5" /><p className="label text-sky">contribution check</p></div>
        <h2 className="font-display mt-3 text-2xl font-bold">
          {check.guideFound ? <>Checked against <code className="inline">{check.guideFound}</code></> : "No CONTRIBUTING.md, so we used standard open source etiquette"}
        </h2>
        {rules.length > 0 && (
          <div className="mt-4 flex items-center gap-3">
            <div className="h-2 flex-1 overflow-hidden rounded-full bg-surface-3">
              <div className="h-full rounded-full bg-lime transition-all" style={{ width: `${(passed / rules.length) * 100}%` }} />
            </div>
            <span className="text-sm text-muted"><b className="text-ink">{passed}</b>/{rules.length} rules pass</span>
          </div>
        )}

        {autoFixes.length > 0 && (
          <div className="mt-5 rounded-2xl border border-lime/30 bg-lime/[0.06] p-4 text-sm">
            <p className="flex items-center gap-2 font-semibold text-lime"><Sparkles className="h-4 w-4" /> MergeMate handled {autoFixes.length} thing{autoFixes.length > 1 ? "s" : ""} for you</p>
            <ul className="mt-2 space-y-1 text-ink/85">{autoFixes.map((f) => <li key={f}>✓ {f}</li>)}</ul>
          </div>
        )}

        {check.cla?.required && (
          <div className="mt-4 rounded-2xl border border-orange/40 bg-orange/[0.07] p-4 text-sm">
            <p className="font-semibold text-orange">✍️ This project needs a signed CLA</p>
            <p className="mt-1 text-ink/80">A one-time legal sign-off. Their bot blocks the PR until you sign it with the same GitHub account (and commit email) you submit from.</p>
            {check.cla.url && (
              <a href={check.cla.url} target="_blank" rel="noreferrer" className="btn-ghost mt-3 py-1.5 text-xs">Sign the agreement <ExternalLink className="h-3.5 w-3.5" /></a>
            )}
          </div>
        )}

        <ul className="mt-5 space-y-2">
          {rules.map((r, i) => (
            <li key={i} className={`flex gap-3 rounded-2xl p-3 text-sm ${r.status === "pass" ? "bg-surface-2" : "bg-orange/[0.06] ring-1 ring-orange/20"}`}>
              <span className="mt-0.5 text-base">{ICON[r.status] || "👉"}</span>
              <div>
                <p className="font-semibold">{r.rule}{r.status !== "pass" && r.status !== "warn" && <span className="ml-2 text-[11px] font-medium text-orange">needs you</span>}</p>
                <p className="text-muted"><Rich text={r.note} /></p>
              </div>
            </li>
          ))}
        </ul>
      </div>

      {changeset && (
        <div className="card p-6">
          <div className="flex flex-wrap items-center gap-2">
            <FileText className="h-5 w-5 text-violet" />
            <p className="label text-violet">changeset</p>
            <label className="ml-auto flex cursor-pointer items-center gap-2 text-sm">
              <input type="checkbox" className="h-4 w-4 accent-[var(--lime)]" checked={changeset.include} onChange={(e) => onChangeset({ ...changeset, include: e.target.checked })} />
              Include in PR
            </label>
          </div>
          <p className="mt-2 text-sm text-muted">This repo uses Changesets for release notes. This file is added to your PR (same as running <code className="inline">pnpm changeset</code>).</p>
          <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_auto]">
            <input className="input" value={changeset.summary} onChange={(e) => onChangeset({ ...changeset, summary: e.target.value })} aria-label="Changelog line" />
            <select className="input sm:w-36" value={changeset.bump} onChange={(e) => onChangeset({ ...changeset, bump: e.target.value as "patch" | "minor" })} aria-label="Version bump">
              <option value="patch">patch (fix)</option>
              <option value="minor">minor (feature)</option>
            </select>
          </div>
          <p className="mt-2 font-mono text-xs text-muted">{changeset.path} · {changeset.packages.join(", ")}</p>
        </div>
      )}

      {boxes.length > 0 && (
        <div className="card p-6">
          <div className="flex items-center justify-between gap-2">
            <p className="label">Template checklist: tick only what&apos;s true</p>
            <span className="text-xs text-muted">{ticked}/{boxes.length} ticked</span>
          </div>
          <p className="mt-1 text-xs text-muted">MergeMate only ticked what it could prove. Maintainers check these, so be honest.</p>
          <ul className="mt-4 space-y-1.5">
            {boxes.map((b) => (
              <li key={b.line}>
                <label className="flex cursor-pointer items-start gap-3 rounded-xl px-2 py-1.5 text-sm hover:bg-surface-2">
                  <input type="checkbox" className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--lime)]" checked={b.checked} onChange={(e) => onBody(toggleCheckbox(body, b.line, e.target.checked))} />
                  <Rich text={b.label} />
                </label>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="card p-6">
        <div className="flex items-center justify-between gap-2">
          <p className="label">Pull request</p>
          {canUndo && (
            <button className="btn-quiet py-1 text-xs" onClick={onUndo}><Undo2 className="h-3.5 w-3.5" /> Undo MergeMate&apos;s rewrite</button>
          )}
        </div>
        <input className="input mt-3 font-semibold" value={title} onChange={(e) => onTitle(e.target.value)} aria-label="PR title" />
        <textarea className="input mt-3 min-h-56 font-mono text-[12.5px]" value={body} onChange={(e) => onBody(e.target.value)} aria-label="PR body" />
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <button className="btn-ghost" disabled={!!busy} onClick={onRecheck}><RefreshCw className={`h-4 w-4 ${busy === "check" ? "animate-spin" : ""}`} /> Re-check</button>
          <button className="btn-lime" onClick={onNext}>
            {todo.length ? <>Continue, I&apos;ll handle {todo.length} item{todo.length > 1 ? "s" : ""}</> : <>All clear, continue</>} <ArrowRight className="h-4 w-4" />
          </button>
        </div>
      </div>
    </section>
  );
}
