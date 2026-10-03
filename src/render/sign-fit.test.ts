// Every printed word in the packs fits its panel (the live check, 2026-10-03: "END OF JURISDICTION"
// printed as "RISDICTI" on all three regions' signs, #395; SF's "SPEED MONITORED" as "ONITORE"; the
// PNW scenes' "FIREWOOD" cut at both edges, #396). The cause was the fitter: it shrank the words
// only for HEIGHT, so one word wider than the panel never shrank. These tests measure text with a
// font table instead of a canvas (there is no DOM here), then run the painters' own layout over
// every sign, board, receipt, event sign, gantry and scene sign in the packs.
import { describe, expect, it } from 'vitest';
import {
  BOARD_SIZES,
  COPY_MIN,
  boardCanvas,
  layoutCopy,
  paintCopy,
  type BoardKind,
  type CopyLayout,
  type MeasureText,
} from './boards';
import { gantryFit, SIGN_TEXTURE_PX } from './event-props';
import type { ScenesFile } from './scenes/data';
import { signCell } from './scenes/layer';

// Advance widths of bold sans-serif, per 1000 em: Helvetica Bold's (Arial Bold has the same
// metrics; iOS draws Helvetica, Android's Roboto Bold is narrower). Unknown characters count as a
// full em.
const WIDTH_GROUPS: [string, number][] = [
  [" ',./`Iijl’‘\\", 278],
  ['!()-:;[]ft', 333],
  ['*{}r', 389],
  ['"', 474],
  ['z“”', 500],
  ['#$_Jaceksvxy–0123456789', 556],
  ['+<=>^~', 584],
  ['?FLTZbdghnopqu', 611],
  ['EPSVXY', 667],
  ['&ABCDHKNRU', 722],
  ['GOQw', 778],
  ['M', 833],
  ['%m', 889],
  ['W', 944],
  ['@', 975],
  ['|', 280],
  ['—…', 1000],
];
const WIDTHS = new Map(WIDTH_GROUPS.flatMap(([chars, w]) => [...chars].map((ch) => [ch, w] as const)));

/** Text width at `size` px, times `slack` (1.15 covers a wider fallback font, such as DejaVu Sans Bold). */
const tableMeasure =
  (slack = 1): MeasureText =>
  (text, size) => {
    let em = 0;
    for (const ch of text) em += WIDTHS.get(ch) ?? 1000;
    return (em / 1000) * size * slack;
  };

/** The audit's measure: the table with 15 % to spare, so a text that passes fits any likely font. */
const AUDIT = tableMeasure(1.15);

/** A stand-in 2D context that measures with the table at its current font and records what it prints. */
function recordingCanvas() {
  const printed: { text: string; size: number }[] = [];
  const measure = tableMeasure();
  const ctx = {
    font: '',
    textAlign: '',
    textBaseline: '',
    fillStyle: '',
    globalAlpha: 1,
    size(): number {
      return Number(/(\d+(?:\.\d+)?)px/.exec(this.font)?.[1] ?? 10);
    },
    measureText(t: string) {
      return { width: measure(t, this.size()) };
    },
    fillText(t: string) {
      printed.push({ text: t, size: this.size() });
    },
  };
  return { ctx: ctx as unknown as CanvasRenderingContext2D, printed, measure };
}

/** Paints `text` on a width x height canvas and returns the widest printed line, and the room it had. */
function paintAndMeasure(width: number, height: number, text: string) {
  const { ctx, printed, measure } = recordingCanvas();
  paintCopy(ctx, width, height, text, '#000');
  const room = width - 2 * Math.round(height * 0.07);
  const lines = printed.map((p) => ({ ...p, width: measure(p.text, p.size) }));
  return { lines, room };
}

describe('the sign painter fits words to the panel in width as well as height', () => {
  it('measures with a table that has every letter and digit once', () => {
    const chars = WIDTH_GROUPS.flatMap(([c]) => [...c]);
    expect(new Set(chars).size).toBe(chars.length);
    for (const ch of "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789 .,!?'\\")
      expect(WIDTHS.has(ch), ch).toBe(true);
  });

  it("prints END OF JURISDICTION whole on the cops' 384 px sign (#395), not RISDICTI", () => {
    const { lines, room } = paintAndMeasure(
      384,
      384,
      'END OF JURISDICTION. Keys County Deputies thank you for leaving.',
    );
    expect(lines.map((l) => l.text)).toContain('JURISDICTION');
    for (const l of lines) expect(l.width, `"${l.text}" at ${l.size}px`).toBeLessThanOrEqual(room);
  });

  it("prints SF's SPEED MONITORED whole", () => {
    const { lines, room } = paintAndMeasure(384, 384, 'SPEED MONITORED. By a human, for now.');
    for (const l of lines) expect(l.width, `"${l.text}" at ${l.size}px`).toBeLessThanOrEqual(room);
  });

  it('prints the PNW scene sign FIREWOOD inside its atlas cell (#396)', () => {
    const cell = signCell([2.2, 0.8]);
    const { lines, room } = paintAndMeasure(cell.width, cell.height, 'FIREWOOD. HONOR SYSTEM. MOSTLY.');
    expect(lines.map((l) => l.text)).toContain('FIREWOOD');
    for (const l of lines) expect(l.width, `"${l.text}" at ${l.size}px`).toBeLessThanOrEqual(room);
  });

  it('keeps the size cap when the words are narrow: the height still decides then', () => {
    const { lines } = paintAndMeasure(384, 384, 'HI');
    // 0.62 of the canvas height (238 px) is the cap; one narrow word fits the width at it.
    expect(lines).toEqual([expect.objectContaining({ text: 'HI', size: 238 })]);
  });

  it('shrinks below its floor rather than clip a word that cannot fit even there', () => {
    const { lines, room } = paintAndMeasure(120, 64, 'SUPERCALIFRAGILISTICEXPIALIDOCIOUS');
    expect(lines).toHaveLength(1);
    expect(lines[0]!.size).toBeLessThan(COPY_MIN.head);
    expect(lines[0]!.width).toBeLessThanOrEqual(room);
  });
});

// The pack data, read the way the game reads it (eager JSON, as scenes.test.ts does).
type Json = Record<string, unknown>;
const regions = import.meta.glob<Json>('../../packs/*/regions/*/region.json', {
  eager: true,
  import: 'default',
});
const modifiers = import.meta.glob<Json>('../../packs/*/modifiers/*.json', {
  eager: true,
  import: 'default',
});
const crews = import.meta.glob<Json>('../../packs/*/crews/*.json', { eager: true, import: 'default' });
const careers = import.meta.glob<Json>('../../packs/*/careers/*.json', { eager: true, import: 'default' });
const riders = import.meta.glob<Json>('../../packs/*/riders/*.json', { eager: true, import: 'default' });
const traffic = import.meta.glob<Json>('../../packs/*/traffic/*.json', { eager: true, import: 'default' });
const roads = import.meta.glob<Json>('../../packs/*/regions/*/roads/*.json', {
  eager: true,
  import: 'default',
});
const scenes = import.meta.glob<ScenesFile>('../../packs/*/assets/scenes/*.json', {
  eager: true,
  import: 'default',
});

const arr = (v: unknown): Json[] => (Array.isArray(v) ? (v as Json[]) : []);
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v : null);
const live = (x: Json) => x['status'] === undefined || x['status'] === 'live';
const short = (path: string) => path.replace(/^(\.\.\/)+packs\//, '');

/** The widest of some names under the audit's measure (a receipt's worst case). */
function widestName(files: Record<string, Json>): string {
  const names = Object.values(files)
    .map((f) => str(f['name']))
    .filter((n): n is string => n !== null);
  return names.reduce((a, b) => (AUDIT(b, 100) > AUDIT(a, 100) ? b : a), '');
}

/** A receipt template filled as career/show.ts `fill` does: {KEY} upper-cased, {key} as is. */
function fillReceipt(template: string, facts: Record<string, string>): string {
  return template.replace(/\{([a-zA-Z]+)\}/g, (all, key: string) => {
    const v = facts[key.toLowerCase()];
    if (v === undefined) return all;
    return key !== key.toLowerCase() && key === key.toUpperCase() ? v.toUpperCase() : v;
  });
}

interface Copy {
  where: string;
  text: string;
}

/** Board copy: region signs and billboards, and the career receipts filled with the longest names. */
function boardCopy(kind: BoardKind): Copy[] {
  const out: Copy[] = [];
  for (const [path, r] of Object.entries(regions))
    for (const item of arr(r[kind === 'sign' ? 'signs' : 'billboards']).filter(live)) {
      const text = str(item['text']);
      if (text) out.push({ where: `${short(path)} ${String(item['id'])}`, text });
    }
  const facts = {
    rival: widestName(riders),
    vehicle: widestName(traffic),
    road: widestName(roads),
    n: '999',
  };
  for (const [path, c] of Object.entries(careers)) {
    const receipts = ((c['show'] as Json | undefined)?.['receipts'] ?? {}) as Json;
    // A takedown receipt is a billboard, a bust receipt a sign (career/receipts.ts).
    for (const t of arr(receipts[kind === 'sign' ? 'bust' : 'takedown']).filter(live)) {
      const text = str(t['text']);
      if (text) out.push({ where: `${short(path)} ${String(t['id'])}`, text: fillReceipt(text, facts) });
    }
  }
  return out;
}

/** Event sign copy: set pieces' warning signs and serial signs, and the cops' END OF JURISDICTION. */
function eventSignCopy(): Copy[] {
  const out: Copy[] = [];
  for (const [path, m] of Object.entries(modifiers))
    for (const e of arr(m['effects'])) {
      const sign = str(e['signText']);
      if (sign) out.push({ where: `${short(path)} signText`, text: sign });
      for (const line of Array.isArray(e['serial']) ? (e['serial'] as unknown[]) : []) {
        const s = str(line);
        if (s) out.push({ where: `${short(path)} serial`, text: s });
      }
    }
  for (const [path, c] of Object.entries(crews)) {
    const sign = str((c['jurisdiction'] as Json | undefined)?.['sign']);
    if (sign) out.push({ where: `${short(path)} jurisdiction`, text: sign });
  }
  return out;
}

/** Every line of a layout, inside its box at its final size, and every block at its floor or above. */
function expectFits(layout: CopyLayout, where: string, text: string): void {
  const blocks = [
    { fit: layout.head, boxH: layout.headBoxH, min: COPY_MIN.head },
    ...(layout.sub ? [{ fit: layout.sub, boxH: layout.subBoxH, min: COPY_MIN.sub }] : []),
  ];
  for (const { fit, boxH, min } of blocks) {
    const at = `${where}: "${text}" (${fit.size}px)`;
    expect(fit.lines.length, at).toBeGreaterThan(0);
    expect(fit.size, `${at} went below its ${min}px floor to fit`).toBeGreaterThanOrEqual(min);
    for (const line of fit.lines)
      expect(AUDIT(line, fit.size), `${at} line "${line}"`).toBeLessThanOrEqual(layout.innerW);
    expect(fit.lines.length * fit.size * 1.08, `${at} is too tall`).toBeLessThanOrEqual(boxH + 1e-6);
  }
}

describe('every printed word in the packs fits its panel at its final size', () => {
  it.each(['sign', 'billboard'] as const)(
    'region %ss and career receipts, on the narrowest and widest panel',
    (kind) => {
      const copy = boardCopy(kind);
      expect(copy.length).toBeGreaterThan(5);
      const size = BOARD_SIZES[kind];
      for (const w of [size.minW, (size.minW + size.maxW) / 2, size.maxW]) {
        const px = boardCanvas(kind, w / size.panelH);
        for (const c of copy)
          expectFits(
            layoutCopy(AUDIT, px.width, px.height, c.text),
            `${c.where} on a ${w} m ${kind}`,
            c.text,
          );
      }
    },
  );

  it("road events' warning and serial signs, and the cops' END OF JURISDICTION", () => {
    const copy = eventSignCopy();
    expect(copy.filter((c) => c.where.endsWith('jurisdiction')).length).toBeGreaterThanOrEqual(3);
    expect(copy.length).toBeGreaterThan(15);
    for (const c of copy)
      expectFits(layoutCopy(AUDIT, SIGN_TEXTURE_PX, SIGN_TEXTURE_PX, c.text), c.where, c.text);
  });

  it("lane-vote gantries' two choices, each on one line in its half", () => {
    let n = 0;
    for (const [path, m] of Object.entries(modifiers))
      for (const e of arr(m['effects']))
        for (const key of ['leftText', 'rightText']) {
          const text = str(e[key]);
          if (!text) continue;
          n++;
          const fit = gantryFit(AUDIT, text);
          expect(fit.fits, `${short(path)} ${key} "${text}" (${fit.size}px)`).toBe(true);
          expect(AUDIT(text, fit.size)).toBeLessThanOrEqual(fit.maxW);
        }
    expect(n).toBeGreaterThanOrEqual(6);
  });

  it('roadside scene signs, in their own atlas cells', () => {
    let n = 0;
    for (const [path, file] of Object.entries(scenes))
      for (const sc of file.scenes) {
        n++;
        const cell = signCell(sc.sign.size);
        expectFits(
          layoutCopy(AUDIT, cell.width, cell.height, sc.sign.text),
          `${short(path)} ${sc.id}`,
          sc.sign.text,
        );
      }
    expect(n).toBeGreaterThanOrEqual(15);
  });
});
