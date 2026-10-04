// The career's screens, plain but phone-friendly (run W-R career lane; the career-show lane dresses
// them): the map screen (region tabs, cash and bike, the region's network map with claimed roads
// glowing, the tiers with their event cards, an event's card with Ride), the garage (bikes, paint,
// the backup code), the career results (won or lost, every dollar, what the map gained, who holds a
// grudge now), the next-region teaser, and two race overlays: a learn-by-riding prompt and the
// event's objective under the position badge. app/ builds every view from src/career/ and handles
// every tap through the callbacks; nothing here changes the career itself.
import type {
  CareerView,
  MapPanel,
  NodeCard,
  PauseMapView,
  PaperView,
  PosterView,
  RivalText,
} from '../career';
import { gigNode, paperNode, posterNode, SHOW_CSS, textsNode, toDom, type GigCard } from './career-show';

export interface CareerCallbacks {
  onRegion(regionId: string): void;
  onRide(nodeId: string): void;
  onBack(): void;
  onBuyBike(key: string): void;
  onRideBike(key: string): void;
  onBuyPaint(id: string): void;
  onPaint(id: string | null): void;
  /** The backup code for this profile. */
  onExport(): Promise<string>;
  /** Loads a backup code; resolves to a line to show (what happened). */
  onImport(code: string): Promise<string>;
  /** The Start Season card's button: starts the next season (it resets the maps). */
  onStartSeason(): void;
  /**
   * The New career button: keeps the old career as a backup code and starts a fresh one; resolves
   * to a line to show.
   */
  onNewCareer(): Promise<string>;
  /** Results: race the same event again. */
  onRetry(): void;
  /** Results or the teaser: back to the map. */
  onMap(): void;
  /** Results: race the event the career suggests next. */
  onNext(): void;
  /** The teaser: the next region's map. */
  onNextRegion(regionId: string): void;
}

export interface GarageBikeRow {
  key: string;
  name: string;
  speed: string;
  priceCash: number;
  state: 'owned' | 'for-sale' | 'locked';
  current: boolean;
  secret: boolean;
  reason: string;
}

export interface GaragePaintRow {
  id: string;
  name: string;
  hex: string;
  priceCash: number;
  state: 'owned' | 'for-sale' | 'locked';
  regionName: string;
  reason: string;
}

/** A career kept as a backup code when the player started a new one. */
export interface GarageBackupRow {
  /** The export code. */
  code: string;
  /** "Season 2, kept 2026-10-04". */
  label: string;
}

export interface GarageView {
  cash: number;
  bikes: GarageBikeRow[];
  paints: GaragePaintRow[];
  /** The paint on the bike ridden now, or null. */
  paint: string | null;
  /** The careers kept as backup codes, oldest first (absent: none). */
  backups?: GarageBackupRow[];
}

export interface CareerResultView {
  /** `WON`, `LOST`, `BUSTED`, `FINISHED 4TH`... */
  title: string;
  eventName: string;
  objectives: { label: string; met: boolean | null; required: boolean }[];
  lines: { label: string; cash: number }[];
  fine: number;
  cashAfter: number;
  /** What changed beyond cash, one line each: tiers opened, roads claimed, secrets, rides, grudges. */
  news: string[];
  /** The suggested next event's name, or null. */
  nextName: string | null;
  /** The region's paper, its headline built from the race's biggest moment (run W-S). */
  paper?: PaperView;
  /** The rivals' texts after the race (run W-S). */
  texts?: readonly RivalText[];
}

/** The career show on the map screen (run W-S): each event's poster, the side gig, the latest texts. */
export interface CareerShowView {
  /** By node id. */
  posters: Readonly<Record<string, PosterView>>;
  gig: GigCard | null;
  texts: readonly RivalText[];
}

export interface TeaserView {
  lines: readonly string[];
  /** The next region (bare id) and its name, or null. */
  next: { id: string; name: string } | null;
}

export interface CareerScreens {
  readonly map: HTMLElement;
  readonly results: HTMLElement;
  readonly teaser: HTMLElement;
  /** The race overlays (app/ shows them during a career race only). */
  readonly overlays: HTMLElement;
  /** The pause screen's network map (ui mounts it in the pause cards; hidden unless filled). */
  readonly pauseMap: HTMLElement;
  showMap(view: CareerView, garage: GarageView, tab?: 'map' | 'garage', show?: CareerShowView): void;
  /** The pause screen's map with the player marked, or null to hide it. */
  showPauseMap(view: PauseMapView | null): void;
  showResults(view: CareerResultView): void;
  showTeaser(view: TeaserView): void;
  /** A learn-by-riding prompt over the race, for a few seconds. */
  prompt(text: string): void;
  /** The event's objective under the position badge, or null to hide it. */
  setObjective(text: string | null): void;
  /** A one-line message on the map screen (a purchase refused, a code loaded). */
  message(text: string): void;
}

/** How long a prompt stays up, ms. [default] */
export const PROMPT_MS = 4200;

export const CAREER_CSS = `
#ui #career, #ui #career-results, #ui #career-teaser { pointer-events: auto; background: rgb(14 8 30 / 94%);
  justify-content: safe center; overflow-y: auto; -webkit-overflow-scrolling: touch;
  padding-top: max(8px, env(safe-area-inset-top)); padding-bottom: 28px; }
#ui #career { justify-content: flex-start; }
#career > *, #career-results > *, #career-teaser > * { flex-shrink: 0; }
.career-col { width: min(720px, 100%); display: flex; flex-direction: column; gap: 8px; align-items: stretch; }
.career-top { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; justify-content: space-between; }
.career-top .small { min-height: 40px; }
.career-wallet { font: 800 15px ui-monospace, 'Courier New', monospace; color: #f5c542; text-align: right; }
.career-wallet small { display: block; color: #f2ead8; font-weight: 600; font-size: 12px; }
.career-wallet .swatch { display: inline-block; width: 12px; height: 12px; border: 2px solid #111; margin-right: 4px;
  vertical-align: middle; }
.career-tabs { display: flex; gap: 6px; flex-wrap: wrap; }
.career-tabs .small { white-space: nowrap; flex: 0 0 auto; font-size: 13px; padding: 4px 10px; }
.career-tabs .small[aria-selected='true'] { background: #111; color: #f5c542; box-shadow: 3px 3px 0 #e0543a; }
.career-head { text-align: left; }
.career-head .title { font-size: 22px; display: inline-block; }
.career-season-card { background: #0006; border: 2px solid #f5c542; padding: 8px 10px; display: flex; flex-direction: column;
  gap: 6px; align-items: stretch; margin-top: 6px; }
.career-season-card .title { font-size: 18px; color: #f5c542; }
.career-tally { font: 600 13px ui-monospace, monospace; color: #f2ead8; margin-top: 4px; }
.career-maps { display: flex; gap: 8px; flex-wrap: wrap; justify-content: center; }
.career-map { flex: 0 0 auto; margin: 0; background: #0b1a24; border: 2px solid #111; box-shadow: 3px 3px 0 #000; }
.career-map figcaption { font: 700 11px ui-monospace, monospace; color: #f2ead8; padding: 2px 6px; background: #111;
  width: 260px; box-sizing: border-box; }
.career-map svg { display: block; width: 260px; height: 150px; }
.career-map .road { fill: none; stroke-linecap: round; stroke-linejoin: round; }
.career-map .road.locked { stroke: #4b5560; stroke-width: 3; stroke-dasharray: 4 4; }
.career-map .road.open { stroke: #d9d2c0; stroke-width: 4; }
.career-map .road.claimed { stroke: #f5c542; stroke-width: 5; filter: drop-shadow(0 0 3px #f5c542); }
.career-map .pin { stroke: #111; stroke-width: 2; cursor: pointer; }
.career-map .pin.open { fill: #fff; }
.career-map .pin.won { fill: #f5c542; }
.career-map .pin.locked { fill: #6b737b; }
.career-map .pin.suggested { stroke: #e0543a; stroke-width: 4; }
.career-map .secret { fill: #7fd1c7; font: 900 14px ui-monospace, monospace; }
.career-map .secret.hint { fill: #f5c542; }
.career-loading { font: 600 13px ui-monospace, monospace; color: #f2ead8; opacity: 0.8; }
.career-tier { background: #0006; border: 1px dashed #fff6; padding: 6px 8px; }
.career-tier h3 { margin: 0 0 6px; font: 900 14px ui-monospace, monospace; letter-spacing: 0.08em; text-transform: uppercase;
  color: #f2ead8; display: flex; justify-content: space-between; gap: 8px; }
.career-tier.locked h3 { color: #8a929a; }
.career-nodes { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 6px; }
.career-node { text-align: left; min-height: 56px; display: flex; flex-direction: column; gap: 2px; padding: 6px 10px !important; }
.career-node .node-name { font-size: 15px; }
.career-node .node-kind { font: 600 12px system-ui, sans-serif; }
.career-node.won { background: #f5c542; }
.career-node.locked { background: #9aa0a6; color: #333; }
.career-node.suggested { box-shadow: 3px 3px 0 #e0543a !important; }
.career-node.boss .node-name::before { content: '★ '; }
.career-detail { background: #f2ead8; color: #111; border: 3px solid #111; box-shadow: 4px 4px 0 #e0543a; padding: 10px 12px;
  text-align: left; font: 500 14px/1.4 system-ui, sans-serif; }
.career-detail h2 { margin: 0 0 4px; font: 900 20px ui-monospace, monospace; }
.career-detail .why { font-weight: 800; }
.career-detail .facts { font: 600 12px ui-monospace, monospace; color: #444; }
.career-detail .row { justify-content: flex-start; margin-top: 8px; }
.career-garage h3 { margin: 6px 0; font: 900 14px ui-monospace, monospace; color: #f2ead8; text-transform: uppercase; }
.garage-row { display: flex; justify-content: space-between; align-items: center; gap: 8px; background: #0006; padding: 6px 8px;
  border: 1px dashed #fff4; font: 600 14px system-ui, sans-serif; text-align: left; }
.garage-row .what small { display: block; font: 500 12px ui-monospace, monospace; opacity: 0.85; }
.garage-row .swatch { display: inline-block; width: 18px; height: 18px; border: 2px solid #111; vertical-align: middle; margin-right: 6px; }
.garage-row.current { outline: 2px solid #f5c542; }
.garage-code textarea { width: 100%; min-height: 64px; box-sizing: border-box; font: 500 12px ui-monospace, monospace; }
.career-msg { font: 700 14px system-ui, sans-serif; color: #f5c542; min-height: 1em; }
.career-results-list { list-style: none; margin: 0; padding: 0; font: 600 14px ui-monospace, monospace; text-align: left; }
.career-results-list li { display: flex; justify-content: space-between; gap: 12px; padding: 2px 0; }
#career-results-objectives li { justify-content: flex-start; gap: 6px; }
.career-results-list li.met::before { content: '✓ '; color: #9cc56b; }
.career-results-list li.missed::before { content: '✗ '; color: #e0543a; }
.career-results-list .total { border-top: 2px solid #f2ead8; font-weight: 900; color: #f5c542; }
.career-news { font: 600 13px system-ui, sans-serif; color: #f2ead8; text-align: left; }
#career-teaser .teaser-line { font: 900 20px/1.3 ui-monospace, 'Courier New', monospace; color: #f2ead8; text-align: center;
  max-width: min(640px, 92vw); text-transform: uppercase; }
#career-teaser .teaser-line:first-of-type { color: #f5c542; font-size: 24px; }
/* The prompt sits low in the middle, between the speed (left) and the touch buttons (right), clear
   of the bark bubble at the top and of the road ahead. It wraps inside the touch buttons' reach on
   both sides (ui/ sets --touch-reach from where it places them; the live check after #430: the
   in-air prompt, the longest, ran under BRAKE on a phone held sideways). [default] */
#career-prompt { position: absolute; left: 50%; transform: translateX(-50%); bottom: max(10px, env(safe-area-inset-bottom));
  width: max-content; max-width: min(520px, calc(100vw - 360px), calc(100vw - 2 * var(--touch-reach, 0px) - 16px));
  background: #111d; color: #f2ead8;
  border-left: 4px solid #f5c542; padding: 6px 12px; box-sizing: border-box;
  font: 800 14px/1.3 ui-monospace, 'Courier New', monospace; pointer-events: none; z-index: 1; }
/* Upright and narrow: across the screen, just above the speed and health (and any touch buttons),
   as low as it can sit under the player's bike. */
@media (max-width: 700px) and (orientation: portrait) {
  #career-prompt { max-width: calc(100vw - 24px); bottom: max(126px, calc(var(--touch-rise, 0px) + 8px)); }
}
/* The landing one-liner (render/air-pays.ts) shares the prompt's band under the bike: while it shows
   (render marks its canvas), the prompt steps aside for its 2 s. [default] */
body:has(canvas[data-landing-line]) #career-prompt { visibility: hidden; }
/* Playtest 3: "The race objective sits over the heat meter." The objective's slot comes from
   ui/hud-layout.ts (--hl-obj-* on #ui), two lines at most where it has the row, three in the narrower column (--hl-obj-lines),
   over the heat badge's slot and never on it: in the column on the pause button's side, past the road
   ahead, where the ticker sits inline; across from the heat badge, under the ticker's slot, where it
   is stacked. The fallbacks are for a screen no plan has settled. [default] */
#hud-objective { position: absolute; top: var(--hl-obj-y, 60px); left: var(--hl-obj-l, 12px);
  right: var(--hl-obj-r, auto); width: max-content; max-width: var(--hl-obj-w, 392px); box-sizing: border-box;
  background: #0009; color: #f5c542; padding: 2px 10px; border-radius: 4px; font: 800 12px/16px ui-monospace, monospace;
  text-align: var(--hl-obj-a, left); pointer-events: none; overflow: hidden; display: -webkit-box;
  -webkit-box-orient: vertical; -webkit-line-clamp: var(--hl-obj-lines, 2); line-clamp: var(--hl-obj-lines, 2);
  overflow-wrap: anywhere; }
@media (orientation: landscape) and (max-height: 520px) {
  .career-map svg { width: 220px; height: 120px; }
  .career-map figcaption { width: 220px; }
  #career-prompt { font-size: 13px; }
}
.career-show { display: flex; flex-direction: column; gap: 8px; }
${SHOW_CSS}`;

type ButtonFn = (id: string, cls: 'big' | 'small', text: string, onClick: () => void) => HTMLButtonElement;

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> = {},
  ...kids: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  Object.assign(node, props);
  node.append(...kids);
  return node;
}

const SVG = 'http://www.w3.org/2000/svg';
function svg<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number> = {},
): SVGElementTagNameMap[K] {
  const node = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  return node;
}

const money = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`;
const safeId = (s: string) => s.replace(/[^a-z0-9-]/gi, '-');
const STATE_WORD: Readonly<Record<string, string>> = { won: 'WON', open: 'OPEN', locked: 'LOCKED' };

/** One network as an SVG: roads by state, event pins (tap one to open its card), found secrets. */
export function mapFigure(panel: MapPanel, onPin: (id: string) => void): HTMLElement {
  const [x0, z0, x1, z1] = panel.bounds;
  const pad = Math.max(40, 0.06 * Math.max(x1 - x0, z1 - z0));
  const w = Math.max(1, x1 - x0 + 2 * pad);
  const h = Math.max(1, z1 - z0 + 2 * pad);
  const scale = Math.max(w, h);
  const root = svg('svg', {
    viewBox: `${x0 - pad} ${z0 - pad} ${w} ${h}`,
    preserveAspectRatio: 'xMidYMid meet',
    role: 'img',
    'aria-label': `${panel.name}: map`,
  });
  // Locked roads under open ones, claimed on top.
  for (const state of ['locked', 'open', 'claimed'] as const) {
    for (const r of panel.roads.filter((x) => x.state === state && !x.hidden)) {
      const line = svg('polyline', {
        class: `road ${state}`,
        points: r.points.map(([x, z]) => `${x.toFixed(1)},${z.toFixed(1)}`).join(' '),
        'vector-effect': 'non-scaling-stroke',
      });
      line.dataset['road'] = r.id;
      root.append(line);
    }
  }
  const radius = scale * 0.028;
  for (const p of panel.pins) {
    const pin = p.boss
      ? svg('rect', {
          x: p.x - radius,
          y: p.z - radius,
          width: radius * 2,
          height: radius * 2,
          transform: `rotate(45 ${p.x} ${p.z})`,
        })
      : svg('circle', { cx: p.x, cy: p.z, r: radius });
    pin.setAttribute('class', `pin ${p.state}${p.suggested ? ' suggested' : ''}`);
    pin.setAttribute('vector-effect', 'non-scaling-stroke');
    pin.dataset['node'] = p.id;
    pin.addEventListener('click', () => onPin(p.id));
    root.append(pin);
  }
  for (const s of panel.secrets.filter((x) => x.found)) {
    const mark = svg('text', {
      x: s.x,
      y: s.z,
      class: 'secret',
      'font-size': scale * 0.06,
      'text-anchor': 'middle',
    });
    mark.textContent = '✦';
    mark.append(svg('title'));
    (mark.lastChild as SVGTitleElement).textContent = s.name;
    root.append(mark);
  }
  // Run W-U: a secret road not found yet is a '?' where it lies (its roads are not drawn).
  for (const s of panel.secrets.filter((x) => !x.found && x.hinted)) {
    const mark = svg('text', {
      x: s.x,
      y: s.z,
      class: 'secret hint',
      'font-size': scale * 0.07,
      'text-anchor': 'middle',
    });
    mark.textContent = '?';
    mark.append(svg('title'));
    (mark.lastChild as SVGTitleElement).textContent = 'Something out there';
    root.append(mark);
  }
  return el('figure', { className: 'career-map' }, el('figcaption', { textContent: panel.name }), root);
}

export function createCareerScreens(cb: CareerCallbacks, button: ButtonFn): CareerScreens {
  // ---- The map screen ---------------------------------------------------------------------------
  const tabs = el('div', { className: 'career-tabs' });
  tabs.setAttribute('role', 'tablist');
  const wallet = el('div', { className: 'career-wallet' });
  const head = el('div', { className: 'career-head' });
  const maps = el('div', { className: 'career-maps' });
  const detail = el('div', { className: 'career-detail', hidden: true });
  const showBox = el('div', { className: 'career-show' });
  const tiers = el('div', { className: 'career-col' });
  const garageBox = el('div', { className: 'career-col career-garage', hidden: true });
  const msg = el('div', { className: 'career-msg', role: 'status' });
  const mapTab = button('career-tab-map', 'small', 'Map', () => setTab('map'));
  const garageTab = button('career-tab-garage', 'small', 'Garage', () => setTab('garage'));
  const top = el(
    'div',
    { className: 'career-top' },
    button('career-back', 'small', 'Menu', () => cb.onBack()),
    el('div', { className: 'row' }, mapTab, garageTab),
    wallet,
  );
  const mapBox = el('div', { className: 'career-col' }, tabs, head, showBox, maps, detail, tiers);
  const map = el(
    'div',
    { id: 'career', className: 'screen', hidden: true },
    el('div', { className: 'career-col' }, top, msg, mapBox, garageBox),
  );
  let view: CareerView | null = null;
  let show: CareerShowView | null = null;
  let tab: 'map' | 'garage' = 'map';
  let openCard: string | null = null;
  const setTab = (t: 'map' | 'garage') => {
    tab = t;
    mapBox.hidden = t !== 'map';
    garageBox.hidden = t !== 'garage';
    mapTab.setAttribute('aria-selected', String(t === 'map'));
    garageTab.setAttribute('aria-selected', String(t === 'garage'));
  };
  const cardOf = (id: string): NodeCard | undefined =>
    view?.tiers.flatMap((t) => t.nodes).find((n) => n.id === id);
  const showCard = (id: string | null) => {
    openCard = id;
    const c = id ? cardOf(id) : undefined;
    detail.hidden = !c;
    if (!c) return;
    const facts = [
      c.route,
      c.km !== null ? `${c.km.toFixed(1)} km` : '',
      c.timeOfDay,
      c.where ? `at ${c.where}` : '',
    ]
      .filter(Boolean)
      .join(' · ');
    const poster = show?.posters[c.id];
    const kids: (Node | string)[] = [
      ...(poster ? [toDom(posterNode(poster))] : []),
      el('h2', { textContent: c.name }),
      el('div', { className: 'facts', textContent: `${c.kindLabel.toUpperCase()} · ${facts}` }),
      el('div', { className: 'why', textContent: c.objective }),
    ];
    if (c.bonuses.length) kids.push(el('div', { textContent: c.bonuses.join(' · ') }));
    kids.push(
      el('div', { textContent: `Riders: ${c.rivals.join(', ')}. A win pays up to ${money(c.prize)}.` }),
    );
    if (c.best) kids.push(el('div', { className: 'facts', textContent: `Best so far: ${c.best}.` }));
    if (c.reason) kids.push(el('div', { className: 'why', textContent: c.reason }));
    const ride = button('career-ride', 'big', c.state === 'won' ? 'Ride again' : 'Ride', () =>
      cb.onRide(c.id),
    );
    ride.disabled = c.state === 'locked';
    kids.push(
      el(
        'div',
        { className: 'row' },
        ride,
        button('career-detail-close', 'small', 'Close', () => showCard(null)),
      ),
    );
    detail.replaceChildren(...kids);
    detail.dataset['node'] = c.id;
    // The card sits under the map: bring it into view when a card lower down opened it.
    if (!map.hidden) detail.scrollIntoView({ block: 'nearest' });
  };
  const drawMap = (v: CareerView) => {
    const swatch = el('span', { className: 'swatch' });
    if (v.bike.paint) swatch.style.background = v.bike.paint;
    wallet.replaceChildren(
      el('span', { id: 'career-cash', textContent: money(v.cash) }),
      el('small', {}, ...(v.bike.paint ? [swatch] : []), v.bike.name),
    );
    tabs.replaceChildren(
      ...v.regions.map((r) => {
        const b = button(
          `career-region-${safeId(r.id)}`,
          'small',
          `${r.name} ${r.won}/${r.nodes}${r.finaleBeaten ? ' ★' : ''}`,
          () => cb.onRegion(r.id),
        );
        b.setAttribute('role', 'tab');
        b.setAttribute('aria-selected', String(r.id === v.region.id));
        return b;
      }),
    );
    const t = v.region.tally;
    const card = v.seasonCard;
    head.replaceChildren(
      el('div', { className: 'title', textContent: v.region.careerName }),
      el('div', {
        className: 'career-tally',
        textContent:
          `${v.season.n > 1 ? `${v.season.label} · ` : ''}` +
          `${v.region.finaleBeaten ? 'Free play' : v.region.tierName} · won ${t.won}/${t.nodes} · ` +
          `roads claimed ${t.claimed} · secrets ${t.secretsFound}/${t.secrets}`,
      }),
      // Every region boss of this season has fallen: the next season is one tap away (it resets the
      // maps, so it never starts by itself).
      ...(card
        ? [
            el(
              'div',
              { className: 'career-season-card', id: 'career-season-card' },
              el('div', { className: 'title', textContent: card.title }),
              ...card.lines.map((line) => el('div', { className: 'career-news', textContent: line })),
              button('career-start-season', 'big', `Start Season ${card.season}`, () => cb.onStartSeason()),
            ),
          ]
        : []),
    );
    maps.replaceChildren(
      ...(v.map.length
        ? v.map.map((p) => mapFigure(p, (id) => showCard(id)))
        : [el('div', { className: 'career-loading', textContent: 'The map draws once the roads are in.' })]),
    );
    tiers.replaceChildren(
      ...v.tiers.map((tier) => {
        const box = el(
          'section',
          { className: `career-tier${tier.open ? '' : ' locked'}` },
          el(
            'h3',
            {},
            el('span', { textContent: tier.name }),
            el('span', {
              textContent: tier.open
                ? tier.requiredWins
                  ? `${Math.min(tier.wins, tier.requiredWins)}/${tier.requiredWins} wins`
                  : ''
                : 'locked',
            }),
          ),
        );
        const grid = el('div', { className: 'career-nodes' });
        for (const n of tier.nodes) {
          const b = button(`career-node-${safeId(n.id)}`, 'small', '', () => showCard(n.id));
          b.classList.add('career-node', n.state);
          if (n.boss) b.classList.add('boss');
          if (n.id === v.suggested) b.classList.add('suggested');
          b.dataset['node'] = n.id;
          b.dataset['state'] = n.state;
          b.append(
            el('span', { className: 'node-name', textContent: n.name }),
            el('span', {
              className: 'node-kind',
              textContent: `${n.kindLabel} · ${STATE_WORD[n.state] ?? n.state}`,
            }),
          );
          grid.append(b);
        }
        box.append(grid);
        return box;
      }),
    );
  };
  const codeBox = el('textarea', { id: 'career-code', placeholder: 'EC1.…' });
  codeBox.setAttribute('aria-label', 'Backup code');
  const drawGarage = (g: GarageView, units: string) => {
    const bikeRows = g.bikes.map((b) => {
      let action: HTMLButtonElement | null = null;
      if (b.state === 'owned' && !b.current)
        action = button(`garage-ride-${safeId(b.key)}`, 'small', 'Ride', () => cb.onRideBike(b.key));
      else if (b.state === 'for-sale')
        action = button(`garage-buy-${safeId(b.key)}`, 'small', `Buy ${money(b.priceCash)}`, () =>
          cb.onBuyBike(b.key),
        );
      const row = el(
        'div',
        { className: `garage-row${b.current ? ' current' : ''}` },
        el(
          'div',
          { className: 'what' },
          `${b.name}${b.secret ? ' (secret)' : ''}`,
          el('small', {
            textContent: b.current
              ? `${b.speed} · riding it`
              : b.state === 'locked'
                ? `${b.speed} · ${b.reason}`
                : b.speed,
          }),
        ),
      );
      if (action) row.append(action);
      row.dataset['bike'] = b.key;
      row.dataset['state'] = b.state;
      return row;
    });
    const paintRows = g.paints.map((p) => {
      let action: HTMLButtonElement | null = null;
      if (p.state === 'owned' && g.paint !== p.id)
        action = button(`garage-paint-${safeId(p.id)}`, 'small', 'Paint it', () => cb.onPaint(p.id));
      else if (p.state === 'for-sale')
        action = button(`garage-paint-${safeId(p.id)}`, 'small', `Buy ${money(p.priceCash)}`, () =>
          cb.onBuyPaint(p.id),
        );
      const swatch = el('span', { className: 'swatch' });
      swatch.style.background = p.hex;
      const row = el(
        'div',
        { className: `garage-row${g.paint === p.id ? ' current' : ''}` },
        el(
          'div',
          { className: 'what' },
          swatch,
          p.name,
          el('small', {
            textContent:
              p.state === 'locked' ? p.reason : `${p.regionName}${g.paint === p.id ? ' · on your bike' : ''}`,
          }),
        ),
      );
      if (action) row.append(action);
      return row;
    });
    const plain = button('garage-paint-none', 'small', 'Its own colours', () => cb.onPaint(null));
    plain.disabled = g.paint === null;
    // New career: two taps (the second within a few seconds), so a stray one never starts over.
    let armed: ReturnType<typeof setTimeout> | null = null;
    const newCareer = button('career-new', 'small', 'New career', () => {
      if (armed === null) {
        newCareer.textContent = 'Tap again to start over';
        armed = setTimeout(() => {
          armed = null;
          newCareer.textContent = 'New career';
        }, 6000);
        return;
      }
      clearTimeout(armed);
      armed = null;
      newCareer.textContent = 'New career';
      void cb.onNewCareer().then(message);
    });
    const keptRows = (g.backups ?? []).map((b, i) =>
      el(
        'div',
        { className: 'garage-row' },
        el('div', { className: 'what', textContent: b.label }),
        el(
          'div',
          { className: 'row' },
          button(`career-backup-show-${i}`, 'small', 'Show code', () => {
            codeBox.value = b.code;
            codeBox.select();
          }),
          button(`career-backup-restore-${i}`, 'small', 'Restore', () => {
            void cb.onImport(b.code).then(message);
          }),
        ),
      ),
    );
    garageBox.replaceChildren(
      el('h3', { textContent: `Bikes (${units})` }),
      ...bikeRows,
      el('h3', { textContent: 'Paint' }),
      el('div', {
        className: 'career-news',
        textContent: 'Your paint is kept with each bike, and rides with it.',
      }),
      ...paintRows,
      el('div', { className: 'row' }, plain),
      el('h3', { textContent: 'Backup code' }),
      el(
        'div',
        { className: 'garage-code' },
        el('div', {
          className: 'career-news',
          textContent: 'Copy it somewhere safe, or paste one to load that career here.',
        }),
        codeBox,
        el(
          'div',
          { className: 'row' },
          button('career-code-copy', 'small', 'Show and copy', () => {
            void cb.onExport().then((code) => {
              codeBox.value = code;
              codeBox.select();
              void navigator.clipboard?.writeText(code).then(
                () => message('Code copied.'),
                () => message('Code shown: copy it by hand.'),
              );
            });
          }),
          button('career-code-load', 'small', 'Load this code', () => {
            void cb.onImport(codeBox.value).then(message);
          }),
        ),
      ),
      el('h3', { textContent: 'New career' }),
      el('div', {
        className: 'career-news',
        textContent:
          'Start over with a fresh garage and an empty map. Your old career is kept as a backup code, ' +
          'and loading it brings it back.',
      }),
      el('div', { className: 'row' }, newCareer),
      ...(keptRows.length > 0 ? [el('h3', { textContent: 'Kept careers' }), ...keptRows] : []),
    );
  };

  // ---- Results and the teaser -------------------------------------------------------------------
  const results = el('div', { id: 'career-results', className: 'screen', hidden: true });
  const teaser = el('div', { id: 'career-teaser', className: 'screen', hidden: true });

  // ---- Race overlays ----------------------------------------------------------------------------
  const promptBox = el('div', { id: 'career-prompt', hidden: true, role: 'status' });
  const objective = el('div', { id: 'hud-objective', hidden: true });
  const overlays = el('div', { id: 'career-overlays' }, promptBox, objective);
  // ---- The pause screen's map (run W-S; interview, 2026-10-02: "Maybe just map on pause") ------
  const pauseMap = el('section', { id: 'pause-map', className: 'card', hidden: true });
  let promptTimer: ReturnType<typeof setTimeout> | null = null;

  let msgTimer: ReturnType<typeof setTimeout> | null = null;
  function message(text: string) {
    msg.textContent = text;
    if (msgTimer) clearTimeout(msgTimer);
    msgTimer = setTimeout(() => (msg.textContent = ''), 5000);
  }

  return {
    map,
    results,
    teaser,
    overlays,
    pauseMap,
    showMap(v, g, t, s) {
      view = v;
      show = s ?? null;
      drawMap(v);
      const gig = s?.gig ? toDom(gigNode(s.gig)) : null;
      const texts = s ? textsNode(s.texts) : null;
      showBox.replaceChildren(...(gig ? [gig] : []), ...(texts ? [toDom(texts)] : []));
      drawGarage(g, g.bikes[0]?.speed.endsWith('mph') ? 'mph' : 'km/h');
      setTab(t ?? tab);
      // Keep an open card open (a purchase, a region's roads arriving), else none.
      showCard(openCard && cardOf(openCard) ? openCard : null);
    },
    showResults(r) {
      const items: HTMLElement[] = r.objectives.map((o) =>
        el(
          'li',
          { className: o.met === true ? 'met' : 'missed' },
          el('span', { textContent: `${o.required ? '' : 'Bonus: '}${o.label}` }),
        ),
      );
      const ledger = r.lines.map((l) =>
        el('li', {}, el('span', { textContent: l.label }), el('span', { textContent: money(l.cash) })),
      );
      if (r.fine > 0)
        ledger.push(
          el('li', {}, el('span', { textContent: 'Fine' }), el('span', { textContent: `-${money(r.fine)}` })),
        );
      ledger.push(
        el(
          'li',
          { className: 'total' },
          el('span', { textContent: 'Cash' }),
          el('span', { textContent: money(r.cashAfter) }),
        ),
      );
      const buttons = [
        button('career-results-map', 'big', 'Map', () => cb.onMap()),
        button('career-results-retry', 'small', 'Race it again', () => cb.onRetry()),
      ];
      if (r.nextName)
        buttons.push(button('career-results-next', 'small', `Next: ${r.nextName}`, () => cb.onNext()));
      results.replaceChildren(
        el(
          'div',
          { className: 'career-col' },
          el('div', { className: 'title', id: 'career-results-title', textContent: r.title }),
          el('div', { className: 'career-tally', textContent: r.eventName }),
          ...(r.paper ? [toDom(paperNode(r.paper))] : []),
          el('ul', { className: 'career-results-list', id: 'career-results-objectives' }, ...items),
          el('ul', { className: 'career-results-list', id: 'career-results-cash' }, ...ledger),
          ...r.news.map((line) => el('div', { className: 'career-news', textContent: line })),
          ...[r.texts ? textsNode(r.texts) : null].flatMap((t) => (t ? [toDom(t)] : [])),
          el('div', { className: 'row' }, ...buttons),
        ),
      );
    },
    showPauseMap(v) {
      pauseMap.hidden = v === null;
      if (!v) {
        pauseMap.replaceChildren();
        return;
      }
      const fig = mapFigure(v.panel, () => undefined);
      fig.querySelector('figcaption')?.replaceChildren(v.title);
      const svgRoot = fig.querySelector('svg');
      if (svgRoot && v.here) {
        const [x0, z0, x1, z1] = v.panel.bounds;
        const r = Math.max(x1 - x0, z1 - z0, 1) * 0.035;
        const dot = svg('circle', { cx: v.here.x, cy: v.here.z, r, class: 'here' });
        dot.setAttribute('vector-effect', 'non-scaling-stroke');
        dot.append(svg('title'));
        (dot.lastChild as SVGTitleElement).textContent = 'You are here';
        svgRoot.append(dot);
      }
      pauseMap.replaceChildren(fig);
    },
    showTeaser(t) {
      const next = t.next;
      teaser.replaceChildren(
        ...t.lines.map((line) => el('div', { className: 'teaser-line', textContent: line })),
        el(
          'div',
          { className: 'row' },
          ...(next
            ? [button('career-teaser-next', 'big', `On to ${next.name}`, () => cb.onNextRegion(next.id))]
            : []),
          button('career-teaser-free', next ? 'small' : 'big', 'Keep riding here', () => cb.onMap()),
        ),
      );
    },
    prompt(text) {
      promptBox.textContent = text;
      promptBox.hidden = false;
      if (promptTimer) clearTimeout(promptTimer);
      promptTimer = setTimeout(() => (promptBox.hidden = true), PROMPT_MS);
    },
    setObjective(text) {
      objective.hidden = text === null;
      if (text !== null && objective.textContent !== text) objective.textContent = text;
      if (text === null) {
        promptBox.hidden = true;
        if (promptTimer) clearTimeout(promptTimer);
      }
    },
    message,
  };
}
