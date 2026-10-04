import { readdirSync, readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { themeAt, type SideTag } from '../../src/render/scenery';

// Signs and billboards stand on land (playtest 1c item 3: "in concrete floating in the river lol";
// maintainer, 2026-10-01b: placement stays on land, never on the road, bridges or water). Run W-P's
// verifier found San Francisco's coldcase-ai billboard standing in the bay at the bridge approach:
// that side was tagged only `fog`, so the renderer drew no land under its posts. The renderer
// draws land only where a side's scenery tags name a land theme (src/render/scenery.ts, themeAt),
// so every slot's side must have one across the slot's whole stretch.
//
// A slot on a railed stretch is left out here: a sign on a bridge rail is a different case (the
// rail, not land, would carry it), checked by eye, not by this test.

interface Slot {
  kind: string;
  id?: string;
  /** The region sign or billboard a board slot shows. */
  item?: string;
  s0: number;
  s1: number;
  d0: number;
  d1: number;
}
interface Barrier {
  s0: number;
  s1: number;
  side?: string;
}
interface Road {
  id: string;
  tags?: SideTag[];
  features?: Slot[];
  barriers?: Barrier[];
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/** Every baked road file in every pack, as [pack-relative path, road]. */
function roads(): [string, Road][] {
  const out: [string, Road][] = [];
  for (const pack of readdirSync(path.join(root, 'packs'))) {
    const regions = path.join(root, 'packs', pack, 'regions');
    if (!existsSync(regions)) continue;
    for (const region of readdirSync(regions)) {
      const dir = path.join(regions, region, 'roads');
      if (!existsSync(dir)) continue;
      for (const f of readdirSync(dir).filter((x) => x.endsWith('.json'))) {
        out.push([`${pack}/${region}/${f}`, JSON.parse(readFileSync(path.join(dir, f), 'utf8')) as Road]);
      }
    }
  }
  return out;
}

describe('sign and billboard slots stand on land', () => {
  const all = roads();

  it('finds the region packs and their slots', () => {
    const slots = all.flatMap(([, r]) => (r.features ?? []).filter((f) => f.kind === 'billboard'));
    console.log(`board slots examined: ${slots.length} on ${all.length} roads`);
    expect(slots.length).toBeGreaterThan(20);
  });

  it('every slot off a railed stretch has a land theme under it, end to end', () => {
    const wet: string[] = [];
    for (const [file, road] of all) {
      for (const f of (road.features ?? []).filter((x) => x.kind === 'billboard')) {
        const side = f.d0 + f.d1 < 0 ? 'left' : 'right';
        const railed = (road.barriers ?? []).some(
          (b) => (b.side === undefined || b.side === 'both' || b.side === side) && b.s0 < f.s1 && b.s1 > f.s0,
        );
        if (railed) continue;
        for (let s = f.s0; s <= f.s1; s += Math.max(1, (f.s1 - f.s0) / 8)) {
          const th = themeAt(road.tags, side, s);
          if (th === 'none' || th === 'water') {
            wet.push(`${file} ${f.id ?? '?'} (${side}, s ${s.toFixed(0)}): ${th}`);
            break;
          }
        }
      }
    }
    expect(wet).toEqual([]);
  });

  // Run W-P (maintainer, 2026-10-01b: "the worlds just feel very empty"): every region sign and
  // billboard has a slot, so each one can be seen and vetoed in a race. Checked per region over all
  // its roads, whichever network carries the slot (a hand-made track, a district's own network, a
  // real-road network's junction sign), so a lane that adds a board or a network edits no list here.
  it("every live region sign and billboard has a slot on one of its region's roads; a slot that names one names a live one", () => {
    const missing: string[] = [];
    const unknown: string[] = [];
    let regions = 0;
    let items = 0;
    for (const pack of readdirSync(path.join(root, 'packs'))) {
      const dir = path.join(root, 'packs', pack, 'regions');
      if (!existsSync(dir)) continue;
      for (const region of readdirSync(dir)) {
        const file = path.join(dir, region, 'region.json');
        if (!existsSync(file)) continue;
        const r = JSON.parse(readFileSync(file, 'utf8')) as {
          signs?: { id: string; status?: string }[];
          billboards?: { id: string; status?: string }[];
        };
        const live = new Set(
          [...(r.signs ?? []), ...(r.billboards ?? [])]
            .filter((i) => (i.status ?? 'live') === 'live')
            .map((i) => i.id),
        );
        const slotted = new Set(
          all
            .filter(([f]) => f.startsWith(`${pack}/${region}/`))
            .flatMap(([f, road]) =>
              (road.features ?? [])
                .filter((x) => x.kind === 'billboard')
                .map((x) => ({ where: `${f} ${x.id ?? '?'}`, item: x.item ?? '' })),
            )
            .map(({ where, item }) => {
              // A slot with no item is a pooled slot: it shows one from the region's pool.
              if (item !== '' && !live.has(item)) unknown.push(`${where}: ${item}`);
              return item;
            }),
        );
        for (const id of live) if (!slotted.has(id)) missing.push(`${pack}/${region}: ${id}`);
        regions++;
        items += live.size;
      }
    }
    console.log(`board items examined: ${items} in ${regions} regions`);
    expect(regions).toBeGreaterThanOrEqual(3);
    expect(items).toBeGreaterThan(20);
    expect(missing, 'region items with no slot on any of its roads').toEqual([]);
    expect(unknown, 'slots naming no live item of their region').toEqual([]);
  });
});
