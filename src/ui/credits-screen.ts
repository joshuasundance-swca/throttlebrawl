// The credits page's DOM (docs/milestones/M5.md, credits-1), drawn from the view in credits.ts. It is
// a lazy chunk: ui/index.ts loads it the first time the menu's Credits button is tapped, so the
// first-load JavaScript does not carry the page. Long texts (the licences, each asset's detail) sit
// behind a <details> row, so the page reads short on a phone and every word is one tap away.
import { AI_LABEL, creditsView, parseCredits, type CreditsView, type Seg } from './credits';

function node<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> = {},
  ...kids: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const n: HTMLElementTagNameMap[K] = document.createElement(tag);
  Object.assign(n, props);
  n.append(...kids);
  return n;
}

const link = (href: string, text: string) =>
  node('a', { href, target: '_blank', rel: 'noopener noreferrer', textContent: text });

/** Runs of text as nodes: a web link opens in a new tab, bold and code keep their look. */
function segNodes(segs: readonly Seg[]): Node[] {
  return segs.map((s) => {
    if (s.href) return link(s.href, s.text);
    if (s.bold) return node('b', { textContent: s.text });
    if (s.code) return node('code', { textContent: s.text });
    return document.createTextNode(s.text);
  });
}

const heading = (text: string) => node('h3', { textContent: text });

/** A row that opens to a long text. */
function textRow(className: string, title: string, text: string): HTMLElement {
  return node(
    'details',
    { className },
    node('summary', { textContent: title }),
    node('pre', { textContent: text }),
  );
}

/** Fills the list from a view: map data first, then every asset, the notices, the licences and the software. */
export function drawCredits(list: HTMLElement, view: CreditsView): void {
  const out: Node[] = [heading('Map data and sources')];
  for (const a of view.attributions) {
    const p = node('p', { className: 'credit-attribution' }, ...segNodes(a.segs));
    if (a.url) p.append(' ', link(a.url, a.url.replace(/^https?:\/\//, '')));
    out.push(p);
  }
  out.push(
    heading('Everything in the game'),
    node('p', {
      className: 'credit-intro',
      textContent: `Anything marked ${AI_LABEL} was written, drawn or voiced by AI. Tap a row for where it came from and its licence.`,
    }),
  );
  for (const e of view.entries) {
    const tag = e.ai ? [node('span', { className: 'credit-ai', textContent: AI_LABEL })] : [];
    const rows = e.details.map((d) =>
      node(
        'p',
        {},
        node('span', { className: 'credit-label', textContent: `${d.label}: ` }),
        ...segNodes(d.segs),
      ),
    );
    out.push(
      node(
        'details',
        { className: e.ai ? 'credit-entry credit-entry-ai' : 'credit-entry' },
        node('summary', {}, ...tag, e.title),
        ...rows,
      ),
    );
  }
  if (view.notices.length > 0) {
    out.push(heading('Notices'));
    for (const n of view.notices) out.push(node('p', { className: 'credit-notice' }, ...segNodes(n)));
  }
  out.push(heading('Licences'));
  for (const l of view.licences) out.push(textRow('credit-licence', l.name, l.text));
  if (view.software.length > 0) {
    out.push(heading('Software'));
    for (const s of view.software) out.push(textRow('credit-software', `${s.title} (${s.licence})`, s.text));
  }
  list.replaceChildren(...out);
  list.scrollTop = 0;
}

/** Draws the page from a parsed dist/credits.json; false when the file is not the credits format. */
export function showCredits(list: HTMLElement, data: unknown): boolean {
  const parsed = parseCredits(data);
  if (!parsed) return false;
  drawCredits(list, creditsView(parsed));
  return true;
}
