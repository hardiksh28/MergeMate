"use client";
import { diffLines } from "diff";

type Row = { kind: "add" | "del" | "ctx" | "gap"; text: string; a?: number; b?: number };

export function buildRows(original: string, updated: string, context = 3): Row[] {
  const parts = diffLines(original, updated);
  const rows: Row[] = [];
  let a = 1;
  let b = 1;
  for (const p of parts) {
    const lines = p.value.replace(/\n$/, "").split("\n");
    for (const l of lines) {
      if (p.added) rows.push({ kind: "add", text: l, b: b++ });
      else if (p.removed) rows.push({ kind: "del", text: l, a: a++ });
      else rows.push({ kind: "ctx", text: l, a: a++, b: b++ });
    }
  }
  // collapse unchanged runs
  const keep = rows.map(() => false);
  rows.forEach((r, i) => {
    if (r.kind !== "ctx") for (let j = Math.max(0, i - context); j <= Math.min(rows.length - 1, i + context); j++) keep[j] = true;
  });
  const out: Row[] = [];
  let skipped = 0;
  rows.forEach((r, i) => {
    if (keep[i]) {
      if (skipped) out.push({ kind: "gap", text: `${skipped} unchanged lines` });
      skipped = 0;
      out.push(r);
    } else skipped++;
  });
  if (skipped) out.push({ kind: "gap", text: `${skipped} unchanged lines` });
  return out;
}

export function diffStat(original: string, updated: string) {
  let add = 0;
  let del = 0;
  for (const p of diffLines(original, updated)) {
    const n = p.value.replace(/\n$/, "").split("\n").length;
    if (p.added) add += n;
    else if (p.removed) del += n;
  }
  return { add, del };
}

export function DiffView({ path, original, updated }: { path: string; original: string; updated: string }) {
  const rows = buildRows(original, updated);
  const { add, del } = diffStat(original, updated);
  return (
    <div className="overflow-hidden rounded-2xl border border-line bg-bg">
      <div className="flex items-center gap-3 border-b border-line bg-surface-2 px-4 py-2.5 text-xs">
        <span className="truncate font-mono text-ink/90">{path}</span>
        <span className="ml-auto font-mono text-lime">+{add}</span>
        <span className="font-mono text-red">-{del}</span>
      </div>
      <div className="scroll-thin overflow-x-auto">
        <table className="w-full border-collapse font-mono text-[12.5px] leading-[1.6]">
          <tbody>
            {rows.map((r, i) =>
              r.kind === "gap" ? (
                <tr key={i} className="bg-surface/60 text-muted">
                  <td colSpan={3} className="px-4 py-1 text-[11px]">⋯ {r.text}</td>
                </tr>
              ) : (
                <tr key={i} className={r.kind === "add" ? "bg-lime/[0.08]" : r.kind === "del" ? "bg-red/[0.08]" : ""}>
                  <td className="w-10 select-none px-2 text-right text-muted/50">{r.a ?? ""}</td>
                  <td className="w-10 select-none px-2 text-right text-muted/50">{r.b ?? ""}</td>
                  <td className={`whitespace-pre pr-4 ${r.kind === "add" ? "text-lime" : r.kind === "del" ? "text-red" : "text-ink/70"}`}>
                    <span className="select-none pr-2 opacity-60">{r.kind === "add" ? "+" : r.kind === "del" ? "-" : " "}</span>
                    {r.text}
                  </td>
                </tr>
              ),
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
