// The HUD's heat badge (playtest 2, the maintainer's COPS answer, interview 2026-10-02: "Mix of 2
// and 1 (reliable but rich)": a patrol in every race plus a heat meter). It reads SimSnapshot.law,
// which sim/cops fills for the player in slot 0: `heat` 0..1, its `tier` 0 to 3, and `lost` once a
// chase is shaken off. It stays out of the way: nothing shows while the player is clean, a small
// badge at the top centre fills as the heat rises and lights one pip per tier, and when the cops
// give up it says so for a few seconds, then goes. [default] Pure view logic (heatBadgeView) is
// apart from the DOM so it can be tested in node.
import type { SimSnapshot } from '../sim/api';

export type LawView = NonNullable<SimSnapshot['law']>;

/** The tiers' words, deadpan (tone guide): 0 a warm meter, 1 one more cop, 2 the pair, 3 the roadblock. */
export const HEAT_LABELS = ['HEAT', 'WANTED', 'PURSUIT', 'ROADBLOCK'] as const;
/** What the badge says when the cops give up. */
export const HEAT_LOST_LABEL = "LOST 'EM";
/** How long the "lost 'em" word stays up, ms. [default] */
export const HEAT_LOST_HOLD_MS = 3000;
/** How long a new tier's flash lasts, ms. [default] */
export const HEAT_FLASH_MS = 600;
/** The tier pips the badge draws. */
export const HEAT_PIPS = 3;

/** What the badge shows this frame. */
export interface HeatBadgeView {
  visible: boolean;
  label: string;
  /** The bar's fill, a whole percent 0..100. */
  fillPct: number;
  /** Pips lit, 0..HEAT_PIPS. */
  pips: number;
  lost: boolean;
  /** True for HEAT_FLASH_MS after the tier rose. */
  flash: boolean;
}

/** The badge's memory between frames (the tier it last showed, when it rose, when "lost" began). */
export interface HeatBadgeMemory {
  tier: number;
  roseAt: number;
  lostAt: number;
}

export const freshHeatMemory = (): HeatBadgeMemory => ({ tier: 0, roseAt: -Infinity, lostAt: -Infinity });

/**
 * One frame of the badge from the snapshot's law (absent, as in a race with no meter: hidden) and
 * the clock in ms. Updates `mem` in place.
 */
export function heatBadgeView(law: LawView | undefined, now: number, mem: HeatBadgeMemory): HeatBadgeView {
  const heat = law && Number.isFinite(law.heat) ? Math.min(1, Math.max(0, law.heat)) : 0;
  const tier = law ? Math.min(HEAT_PIPS, Math.max(0, Math.floor(law.tier))) : 0;
  if (tier > mem.tier) mem.roseAt = now;
  mem.tier = tier;
  const lost = !!law?.lost && heat <= 0;
  if (!lost) mem.lostAt = -Infinity;
  else if (mem.lostAt === -Infinity) mem.lostAt = now;
  const showLost = lost && now - mem.lostAt < HEAT_LOST_HOLD_MS;
  const fillPct = Math.round(heat * 100);
  return {
    visible: fillPct > 0 || tier > 0 || showLost,
    label: showLost ? HEAT_LOST_LABEL : (HEAT_LABELS[tier] ?? 'HEAT'),
    fillPct,
    pips: tier,
    lost: showLost,
    flash: now - mem.roseAt < HEAT_FLASH_MS,
  };
}

export const HEAT_BADGE_CSS = `
#hud-heat { position: absolute; top: max(8px, env(safe-area-inset-top)); left: 50%; transform: translateX(-50%);
  padding: 3px 10px 4px; background: #000a; border: 2px solid #e0543a; border-radius: 4px;
  font: 800 12px ui-monospace, 'Courier New', monospace; letter-spacing: 0.1em; color: #f2ead8;
  white-space: nowrap; text-align: center; pointer-events: none; }
#hud-heat .heat-row { display: flex; align-items: center; gap: 6px; justify-content: center; }
#hud-heat .heat-pip { width: 8px; height: 8px; border: 1px solid #f2ead8; border-radius: 50%; }
#hud-heat .heat-pip.on { background: #e0543a; border-color: #e0543a; }
#hud-heat .heat-bar { width: 96px; height: 5px; margin-top: 3px; background: #fff3; }
#hud-heat .heat-bar > div { height: 100%; width: 0; background: linear-gradient(90deg, #f5c542, #e0543a); }
#hud-heat.lost { border-color: #f5c542; color: #f5c542; }
#hud-heat.flash { animation: tb-heat-flash 0.3s ease-out 2; }
@keyframes tb-heat-flash { 0% { background: #e0543a; } 100% { background: #000a; } }
`;

export interface HeatBadge {
  root: HTMLElement;
  /** One frame from the snapshot's law; `now` in ms (performance.now by default). */
  update(law: LawView | undefined, now?: number): void;
  /** A new race: hidden, memory cleared. */
  reset(): void;
}

/** The badge's DOM: a label, three tier pips and a bar. Writes only what changed. */
export function createHeatBadge(): HeatBadge {
  const div = (cls: string) => {
    const d = document.createElement('div');
    d.className = cls;
    return d;
  };
  const root = div('');
  root.id = 'hud-heat';
  root.hidden = true;
  root.setAttribute('role', 'status');
  const row = div('heat-row');
  const label = document.createElement('span');
  label.className = 'heat-label';
  const pips: HTMLElement[] = [];
  for (let i = 0; i < HEAT_PIPS; i++) pips.push(div('heat-pip'));
  row.append(label, ...pips);
  const fill = document.createElement('div');
  const bar = div('heat-bar');
  bar.append(fill);
  root.append(row, bar);
  let mem = freshHeatMemory();
  let last = '';
  return {
    root,
    update(law, now = performance.now()) {
      const v = heatBadgeView(law, now, mem);
      const key = `${v.visible}|${v.label}|${v.fillPct}|${v.pips}|${v.lost}|${v.flash}`;
      if (key === last) return;
      last = key;
      root.hidden = !v.visible;
      if (!v.visible) return;
      label.textContent = v.label;
      root.setAttribute(
        'aria-label',
        v.lost ? 'The cops gave up' : `Heat ${v.fillPct} percent, level ${v.pips}`,
      );
      for (const [i, p] of pips.entries()) p.classList.toggle('on', i < v.pips);
      fill.style.width = `${v.fillPct}%`;
      root.classList.toggle('lost', v.lost);
      root.classList.toggle('flash', v.flash);
    },
    reset() {
      mem = freshHeatMemory();
      last = '';
      root.hidden = true;
    },
  };
}
