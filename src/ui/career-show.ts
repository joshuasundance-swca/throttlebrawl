// The career's show, drawn (run W-S, career-show lane; interview, 2026-10-02: "A quiet frame", and
// "Maybe all of the above in whatever mixes make sense and actually work well"): the stream's poster
// on an event card, the region's paper after a race (a Keys rag, a damp Pacific Northwest
// newsletter, an SF tech blog), the rivals' texts, the side gig on the map, and the pause screen's
// "you are here". Still-and-text pieces in the menus' zine style (docs/tone-guide.md: photocopy
// texture, cut-out headings, typewriter labels), all CSS: no images to load.
//
// Each piece is built as a small node tree first (`ShowNode`), so the unit tests read the rendered
// text, classes and colours without a browser; `toDom` makes the elements. Lives in the career
// screens' lazy chunk (career-screen.ts imports it), off the first-load JavaScript budget.
import type { PaperView, PosterView, RivalText } from '../career';

export interface ShowNode {
  tag: string;
  cls?: string;
  id?: string;
  text?: string;
  style?: Readonly<Record<string, string>>;
  attrs?: Readonly<Record<string, string>>;
  kids?: readonly ShowNode[];
}

const n = (tag: string, props: Omit<ShowNode, 'tag' | 'kids'> = {}, ...kids: ShowNode[]): ShowNode => ({
  tag,
  ...props,
  ...(kids.length ? { kids } : {}),
});

/** Every text in a tree, in order (what a reader sees). */
export function textOf(node: ShowNode): string {
  return [node.text ?? '', ...(node.kids ?? []).map(textOf)].filter(Boolean).join(' ');
}

/** Every node with a class, depth first. */
export function findAll(node: ShowNode, cls: string): ShowNode[] {
  const own = (node.cls ?? '').split(' ').includes(cls) ? [node] : [];
  return [...own, ...(node.kids ?? []).flatMap((k) => findAll(k, cls))];
}

export function toDom(node: ShowNode): HTMLElement {
  const e = document.createElement(node.tag);
  if (node.cls) e.className = node.cls;
  if (node.id) e.id = node.id;
  if (node.text !== undefined) e.textContent = node.text;
  for (const [k, v] of Object.entries(node.style ?? {})) e.style.setProperty(k, v);
  for (const [k, v] of Object.entries(node.attrs ?? {})) e.setAttribute(k, v);
  for (const k of node.kids ?? []) e.append(toDom(k));
  return e;
}

const money = (v: number) => `$${Math.round(v).toLocaleString('en-US')}`;

/** The stream's poster at the top of an event card: the chyron, then a face and a beef line each. */
export function posterNode(p: PosterView): ShowNode {
  return n(
    'div',
    { cls: 'show-poster' },
    n(
      'div',
      { cls: 'show-chyron' },
      n('span', { cls: 'show-live', text: '● REC' }),
      n('span', { text: p.live }),
    ),
    n(
      'div',
      { cls: 'show-faces' },
      ...p.faces.map((f) =>
        n(
          'div',
          { cls: `show-face${f.grudge >= 6 ? ' hot' : ''}`, attrs: { 'data-rider': f.id } },
          n('span', {
            cls: 'show-badge',
            text: f.initials,
            style: { background: f.colours[0], color: f.colours[1] },
            attrs: { 'aria-hidden': 'true' },
          }),
          n(
            'span',
            { cls: 'show-face-words' },
            n('b', { text: f.grudge > 0 ? `${f.name} · grudge ${f.grudge}/10` : f.name }),
            n('span', { cls: 'show-beef', text: f.beef }),
          ),
        ),
      ),
    ),
  );
}

/** The region's paper after a career race: masthead, dateline, headline, the still and its caption. */
export function paperNode(p: PaperView): ShowNode {
  return n(
    'article',
    { cls: `show-paper paper-${p.style}`, id: 'career-paper', attrs: { 'data-moment': p.moment } },
    n('div', { cls: 'paper-mast', text: p.name }),
    n('div', { cls: 'paper-date', text: p.tagline ? `${p.tagline} · ${p.dateline}` : p.dateline }),
    n('h2', { cls: 'paper-headline', text: p.headline }),
    n(
      'div',
      { cls: 'paper-body' },
      n('figure', { cls: 'paper-still' }, n('figcaption', { text: p.caption })),
      n('p', { cls: 'paper-deck', text: p.deck }),
    ),
  );
}

/** The rivals' texts, as a phone's lock screen. */
export function textsNode(texts: readonly RivalText[]): ShowNode | null {
  if (texts.length === 0) return null;
  return n(
    'section',
    { cls: 'show-texts', id: 'career-texts', attrs: { 'aria-label': 'Texts from rivals' } },
    n('div', {
      cls: 'texts-head',
      text: texts.length === 1 ? '1 NEW MESSAGE' : `${texts.length} NEW MESSAGES`,
    }),
    ...texts.map((t) =>
      n(
        'div',
        { cls: 'show-text', attrs: { 'data-rider': t.id } },
        n(
          'div',
          { cls: 'text-from' },
          n('span', { cls: 'text-dot', style: { background: t.colour }, attrs: { 'aria-hidden': 'true' } }),
          n('b', { text: t.from }),
          ...(t.grudge > 0 ? [n('small', { text: `grudge ${t.grudge}/10` })] : []),
        ),
        n('div', { cls: 'text-bubble', text: t.line }),
        n('div', { cls: 'text-memory', text: t.memory }),
      ),
    ),
  );
}

/** The map screen's side gig card. */
export interface GigCard {
  name: string;
  need: string;
  text: string;
  cash: number;
  regionName: string;
}

export function gigNode(g: GigCard): ShowNode {
  return n(
    'section',
    { cls: 'show-gig', id: 'career-gig' },
    n('div', { cls: 'gig-tag', text: 'SIDE GIG' }),
    n('b', { cls: 'gig-name', text: `${g.name} · pays ${money(g.cash)}` }),
    n('div', { text: g.text }),
    n('div', { cls: 'gig-need', text: `${g.need}, in your next career race in ${g.regionName}.` }),
  );
}

export const SHOW_CSS = `
.show-poster { margin: -10px -12px 8px; padding: 6px 10px 8px; background: #111; color: #f2ead8;
  border-bottom: 3px solid #e0543a; }
.show-chyron { display: flex; gap: 8px; align-items: center; font: 800 12px ui-monospace, monospace; letter-spacing: 0.06em; }
.show-live { color: #ff4a3d; }
.show-faces { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 210px), 1fr)); gap: 6px; margin-top: 6px; }
.show-face { display: flex; gap: 8px; align-items: flex-start; min-width: 0; }
.show-face.hot .show-badge { box-shadow: 0 0 0 2px #e0543a; }
.show-badge { flex: 0 0 34px; width: 34px; height: 34px; line-height: 30px; border-radius: 50%; text-align: center;
  font: 900 13px ui-monospace, monospace; border: 2px solid #f2ead8; box-sizing: border-box; transform: rotate(-4deg); }
.show-face-words { display: flex; flex-direction: column; min-width: 0; font: 500 12px/1.3 system-ui, sans-serif;
  overflow-wrap: anywhere; }
.show-face-words b { font: 800 12px ui-monospace, monospace; }
.show-beef { font-style: italic; opacity: 0.9; }
.show-paper { text-align: left; color: #111; border: 3px solid #111; box-shadow: 5px 5px 0 #000; padding: 10px 12px;
  overflow-wrap: anywhere; }
.show-paper .paper-mast { font: 900 26px/1.15 Georgia, 'Times New Roman', serif; text-align: center; letter-spacing: 0.02em; }
.show-paper .paper-date { font: 600 11px ui-monospace, monospace; text-align: center; border-top: 2px solid currentColor;
  border-bottom: 2px solid currentColor; margin: 6px 0; padding: 2px 0; text-transform: uppercase; }
.show-paper .paper-headline { margin: 4px 0 8px; font: 900 24px/1.15 Impact, 'Arial Narrow', sans-serif; text-transform: uppercase; }
.show-paper .paper-body { display: flex; gap: 10px; flex-wrap: wrap; align-items: flex-start; }
.show-paper .paper-still { flex: 1 1 160px; margin: 0; min-height: 90px; display: flex; align-items: flex-end;
  background: radial-gradient(circle at 30% 40%, #0000 0 22%, #0003 23% 100%),
    radial-gradient(#0007 1px, #0000 1.6px) 0 0 / 5px 5px, #d8d0bc; border: 2px solid #111; }
.show-paper .paper-still figcaption { background: #111; color: #f2ead8; font: 600 11px/1.3 ui-monospace, monospace;
  padding: 2px 6px; width: 100%; box-sizing: border-box; }
.show-paper .paper-deck { flex: 2 1 200px; margin: 0; font: 600 14px/1.35 Georgia, serif; }
.paper-rag { background: #fff6c8; }
.paper-rag .paper-mast { color: #c4161c; font-family: Impact, 'Arial Narrow', sans-serif; text-transform: uppercase; }
.paper-rag .paper-headline { color: #111; background: linear-gradient(transparent 60%, #ffd23f 60%); }
.paper-newsletter { background: repeating-linear-gradient(0deg, #0000 0 22px, #2d4a3a14 22px 23px),
  radial-gradient(circle at 88% 14%, #0000 0 20px, #6b4a2a33 21px 24px, #0000 25px), #e4e7dc; color: #1d2a22; }
.paper-newsletter .paper-mast, .paper-newsletter .paper-headline { font-family: 'Courier New', ui-monospace, monospace; }
.paper-newsletter .paper-headline { font-size: 21px; letter-spacing: -0.01em; }
.paper-newsletter .paper-still { background: radial-gradient(#1d2a2266 1px, #0000 1.6px) 0 0 / 4px 4px, #b9c4b0;
  filter: contrast(1.2); }
.paper-blog { background: #fdfdfd; border-radius: 10px; border-color: #3a3f4a; box-shadow: 0 3px 0 #3a3f4a; }
.paper-blog .paper-mast { font: 800 18px system-ui, sans-serif; text-align: left; color: #3a3f4a; text-transform: lowercase; }
.paper-blog .paper-date { text-align: left; border: 0; color: #6b7280; text-transform: none; }
.paper-blog .paper-headline { font: 800 22px/1.15 system-ui, sans-serif; text-transform: none; }
.paper-blog .paper-still { border-radius: 8px; background: linear-gradient(135deg, #3cc8d8, #8b5cf6 60%, #f472b6); }
.show-texts { background: #0b0b10; border: 2px solid #f2ead8; border-radius: 14px; padding: 8px 10px; text-align: left;
  display: flex; flex-direction: column; gap: 8px; color: #f2ead8; }
.texts-head { font: 800 11px ui-monospace, monospace; letter-spacing: 0.1em; opacity: 0.8; }
.show-text { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
.text-from { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; font: 700 13px system-ui, sans-serif; }
.text-from small { font: 600 11px ui-monospace, monospace; color: #e0543a; }
.text-dot { width: 10px; height: 10px; border-radius: 50%; display: inline-block; border: 1px solid #f2ead8; }
.text-bubble { align-self: flex-start; max-width: 100%; background: #2b2d36; border-radius: 14px 14px 14px 4px;
  padding: 6px 10px; font: 500 14px/1.35 system-ui, sans-serif; overflow-wrap: anywhere; box-sizing: border-box; }
.text-memory { font: 500 11px ui-monospace, monospace; opacity: 0.65; overflow-wrap: anywhere; }
.show-gig { background: #f2ead8; color: #111; border: 2px dashed #111; padding: 6px 10px; text-align: left;
  font: 500 13px/1.35 system-ui, sans-serif; box-shadow: 3px 3px 0 #3fa7a0; overflow-wrap: anywhere; }
.gig-tag { display: inline-block; background: #111; color: #f5c542; font: 900 11px ui-monospace, monospace;
  letter-spacing: 0.12em; padding: 1px 6px; transform: rotate(-2deg); margin-bottom: 2px; }
.gig-name { display: block; font: 800 14px ui-monospace, monospace; }
.gig-need { font: 700 12px ui-monospace, monospace; color: #7a1f1f; }
#pause-map .career-map { margin: 0 auto; }
#pause-map .career-map svg, #pause-map .career-map figcaption { width: 100%; max-width: 360px; }
#pause-map .career-map svg { height: auto; aspect-ratio: 26 / 15; }
#pause-map .here { fill: #ff4a3d; stroke: #fff; stroke-width: 3; }
@media (orientation: landscape) and (max-height: 520px) {
  .show-paper .paper-mast { font-size: 20px; }
  .show-paper .paper-headline { font-size: 19px; }
}
`;
