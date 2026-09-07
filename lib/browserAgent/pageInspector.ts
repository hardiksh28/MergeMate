/**
 * MergeMate Browser Agent — Page Inspector
 * Builds a compact, structured representation of the current page using the
 * Chrome DevTools Protocol accessibility tree (Accessibility.getFullAXTree)
 * rather than raw DOM or screenshots. This keeps the representation small
 * enough to hand to an AI agent while still describing buttons, links, text
 * fields, checkboxes, comboboxes, headings, and labels.
 */

import { Page } from 'playwright';
import { PageElementDescriptor, PageSnapshot } from './types';

const INTERESTING_ROLES = new Set([
  'button',
  'link',
  'textbox',
  'searchbox',
  'checkbox',
  'radio',
  'combobox',
  'listbox',
  'option',
  'menuitem',
  'tab',
  'heading',
  'switch',
  'slider',
]);

const MAX_ELEMENTS = 150;

interface RawAXNode {
  nodeId: string;
  ignored: boolean;
  role?: { value?: string };
  name?: { value?: string };
  value?: { value?: any };
  properties?: { name: string; value?: { value?: any } }[];
  parentId?: string;
  childIds?: string[];
}

function findProperty(node: RawAXNode, name: string): any {
  return node.properties?.find((p) => p.name === name)?.value?.value;
}

function flattenAXTree(nodes: RawAXNode[]): PageElementDescriptor[] {
  const byId = new Map<string, RawAXNode>();
  nodes.forEach((n) => byId.set(n.nodeId, n));

  const roots = nodes.filter((n) => !n.parentId || !byId.has(n.parentId));
  const elements: PageElementDescriptor[] = [];
  const visited = new Set<string>();
  let refCounter = 1;

  const visit = (node: RawAXNode) => {
    if (!node || visited.has(node.nodeId) || elements.length >= MAX_ELEMENTS) return;
    visited.add(node.nodeId);

    if (!node.ignored) {
      const role = node.role?.value || '';
      const name = (node.name?.value || '').trim();

      if (INTERESTING_ROLES.has(role) && (name || role === 'textbox' || role === 'searchbox')) {
        elements.push({
          ref: refCounter++,
          role,
          name,
          value: node.value?.value !== undefined ? String(node.value.value) : undefined,
          checked: typeof findProperty(node, 'checked') === 'boolean' ? findProperty(node, 'checked') : undefined,
          disabled: Boolean(findProperty(node, 'disabled')),
          level: findProperty(node, 'level'),
          boundingBox: null,
        });
      }
    }

    (node.childIds || []).forEach((childId) => {
      const child = byId.get(childId);
      if (child) visit(child);
    });
  };

  roots.forEach(visit);
  return elements;
}

/**
 * Produces a compact structured snapshot of the page: URL, title, viewport, and
 * a bounded list of interactive/semantic elements drawn from the CDP
 * accessibility tree. Does not send the raw DOM or rely on screenshots as the
 * source of truth.
 */
export async function inspectPage(page: Page): Promise<PageSnapshot> {
  const [url, title, viewportSize, elements] = await Promise.all([
    Promise.resolve(page.url()),
    page.title().catch(() => ''),
    Promise.resolve(page.viewportSize()),
    fetchAccessibilityElements(page),
  ]);

  // Attach bounding boxes for the elements we could resolve cheaply via role+name,
  // best-effort only — a missing box never blocks action execution since actions
  // resolve elements live through Playwright locators, not these coordinates.
  await attachBoundingBoxes(page, elements);

  let visibleText = '';
  try {
    visibleText = await page.evaluate(() => document.body?.innerText?.slice(0, 2000) || '');
  } catch {
    visibleText = '';
  }

  return {
    url,
    title: title || '',
    viewport: viewportSize || { width: 0, height: 0 },
    elements,
    visibleText,
    timestamp: new Date().toISOString(),
  };
}

async function fetchAccessibilityElements(page: Page): Promise<PageElementDescriptor[]> {
  let cdpSession;
  try {
    cdpSession = await page.context().newCDPSession(page);
    await cdpSession.send('Accessibility.enable');
    const { nodes } = await cdpSession.send('Accessibility.getFullAXTree');
    return flattenAXTree(nodes as unknown as RawAXNode[]);
  } catch (err: any) {
    console.warn(`[PageInspector] Failed to read accessibility tree: ${err?.message}`);
    return [];
  } finally {
    if (cdpSession) {
      await cdpSession.send('Accessibility.disable').catch(() => {});
      await cdpSession.detach().catch(() => {});
    }
  }
}

async function attachBoundingBoxes(page: Page, elements: PageElementDescriptor[]): Promise<void> {
  const candidates = elements.slice(0, 40); // bound cost of extra locator queries
  await Promise.all(
    candidates.map(async (el) => {
      if (!el.name) return;
      try {
        const locator = page.getByRole(el.role as any, { name: el.name, exact: false }).first();
        const box = await locator.boundingBox({ timeout: 500 }).catch(() => null);
        if (box) {
          el.boundingBox = { x: box.x, y: box.y, width: box.width, height: box.height };
        }
      } catch {
        // Best-effort only; leave boundingBox as null.
      }
    })
  );
}
