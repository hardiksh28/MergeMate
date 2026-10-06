// Keeps prompts small: send whole files when short, otherwise numbered windows around relevant lines.
const MAX_FILE_CHARS = 7000;

export function snippet(content: string, terms: string[], budget = MAX_FILE_CHARS) {
  if (content.length <= budget) return content;
  const lines = content.split("\n");
  const lowered = terms.map((t) => t.toLowerCase()).filter((t) => t.length > 2);
  const hits: number[] = [];
  lines.forEach((l, i) => {
    const ll = l.toLowerCase();
    if (lowered.some((t) => ll.includes(t))) hits.push(i);
  });
  if (!hits.length) return lines.slice(0, 160).join("\n") + "\n/* ...file truncated... */";
  const keep = new Set<number>();
  for (const h of hits.slice(0, 12)) for (let i = Math.max(0, h - 25); i < Math.min(lines.length, h + 35); i++) keep.add(i);
  const out: string[] = [];
  let last = -2;
  for (const i of [...keep].sort((a, b) => a - b)) {
    if (i !== last + 1) out.push("/* ... */");
    out.push(lines[i]);
    last = i;
    if (out.join("\n").length > budget) break;
  }
  return out.join("\n");
}

const SKIP = /(^|\/)(node_modules|dist|build|vendor|\.next|coverage|__snapshots__|\.git)\/|\.(png|jpe?g|gif|svg|ico|webp|woff2?|ttf|eot|mp4|mp3|zip|gz|lock|min\.js|map|pdf)$|(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|Cargo\.lock|poetry\.lock|go\.sum)$/i;

export function rankPaths(paths: string[], text: string, cap = 350) {
  const words = [...new Set(text.toLowerCase().match(/[a-z][a-z0-9_]{3,}/g) || [])].slice(0, 60);
  return paths
    .filter((p) => !SKIP.test(p))
    .map((p) => {
      const lp = p.toLowerCase();
      let s = 0;
      for (const w of words) if (lp.includes(w)) s += 3;
      if (/(^|\/)(src|lib|app|packages|pkg|internal|cmd)\//.test(lp)) s += 1;
      if (/test|spec|__tests__/.test(lp)) s -= 1;
      if (/(^|\/)(docs?|examples?)\//.test(lp)) s -= 1;
      return { p, s };
    })
    .sort((a, b) => b.s - a.s || a.p.length - b.p.length)
    .slice(0, cap)
    .map((x) => x.p);
}

const indentOf = (l: string) => l.match(/^\s*/)![0];

/**
 * Models often send the first line of a block unindented and the rest fully indented. Work out how far the
 * model's indentation is off from the file (using the matched lines) and shift the replacement by that much.
 */
function reindent(find: string[], file: string[], replace: string) {
  const unit = file.map(indentOf).find((i) => i)?.[0] === "\t" ? "\t" : " ";
  const offsets = find
    .map((l, j) => ({ j, d: indentOf(file[j]).length - indentOf(l).length, ok: !!l.trim() }))
    .filter((x) => x.ok && (x.j > 0 || find.length === 1));
  const offset = offsets.length ? offsets[0].d : 0;
  return replace.split("\n").map((l, i) => {
    if (!l.trim()) return l;
    const own = indentOf(l).length;
    // the quirk: unindented first line where the file's first matched line is indented
    if (i === 0 && own === 0 && indentOf(find[0]).length === 0) return indentOf(file[0]) + l;
    return unit.repeat(Math.max(0, own + offset)) + l.trimStart();
  });
}

export function applyEdits(
  original: string,
  edits: { find: string; replace: string }[],
): { updated: string; failed: string[] } {
  let updated = original;
  const failed: string[] = [];
  for (const e of edits) {
    if (!e.find) {
      updated = updated.replace(/\n?$/, "\n") + e.replace;
      continue;
    }
    // line-based match (ignores indentation drift), then keep the file's own indentation
    const findLines = e.find.replace(/\n+$/, "").split("\n");
    const fl = findLines.map((l) => l.trim());
    const ul = updated.split("\n");
    let at = -1;
    for (let i = 0; i <= ul.length - fl.length && at < 0; i++) {
      if (fl.every((l, j) => ul[i + j].trim() === l)) at = i;
    }
    if (at >= 0) {
      const matched = ul.slice(at, at + fl.length);
      ul.splice(at, fl.length, ...reindent(findLines, matched, e.replace.replace(/\n+$/, "")));
      updated = ul.join("\n");
    } else if (!e.find.includes("\n") && updated.includes(e.find)) {
      updated = updated.replace(e.find, e.replace); // partial-line edit
    } else failed.push(e.find.slice(0, 80));
  }
  return { updated, failed };
}
