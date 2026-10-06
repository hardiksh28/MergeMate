// Pure helpers for shaping a PR so it matches a project's contribution rules. Safe for client and server.

export type Changeset = { path: string; packages: string[]; bump: "patch" | "minor"; summary: string; include: boolean };

/** The .changeset/*.md file Changesets expects: front matter of package bumps, then the changelog line. */
export function changesetContent(c: Pick<Changeset, "packages" | "bump" | "summary">) {
  return `---\n${c.packages.map((p) => `"${p}": ${c.bump}`).join("\n")}\n---\n\n${c.summary.trim()}\n`;
}

export type Checkbox = { line: number; checked: boolean; label: string };

/** Markdown task-list items ("- [ ] …") in a PR body, outside code fences. */
export function parseCheckboxes(body: string): Checkbox[] {
  const out: Checkbox[] = [];
  let fenced = false;
  body.split("\n").forEach((l, i) => {
    if (/^\s*```/.test(l)) fenced = !fenced;
    if (fenced) return;
    const m = l.match(/^\s*[-*]\s+\[( |x|X)\]\s+(.*)$/);
    if (m) out.push({ line: i, checked: m[1].toLowerCase() === "x", label: m[2].replace(/<!--.*?-->/g, "").trim() });
  });
  return out;
}

export function toggleCheckbox(body: string, line: number, checked: boolean) {
  const lines = body.split("\n");
  lines[line] = lines[line].replace(/\[( |x|X)\]/, checked ? "[x]" : "[ ]");
  return lines.join("\n");
}

/**
 * Put the contributor's own explanation inside the template's first section (usually "Description"),
 * so the template's structure stays intact for bots and maintainers.
 */
export function insertOwnWords(body: string, words: string) {
  const w = words.trim();
  if (!w) return body;
  const block = `**In my words:** ${w}`;
  const lines = body.split("\n");
  const h = lines.findIndex((l) => /^#{1,6}\s+\S/.test(l));
  if (h === -1) return `${block}\n\n${body}`;
  lines.splice(h + 1, 0, "", block);
  return lines.join("\n");
}
