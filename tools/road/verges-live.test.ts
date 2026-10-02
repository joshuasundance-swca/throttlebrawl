import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { themeAt } from '../../src/render/scenery';
import { lanesPerDirection, resolveVerge } from '../../src/road/cross-section';
import type { BakedRoad } from '../../src/road/types';

// The W-Q cross-section's defaults over every live road (interview, 2026-10-02: "Anywhere with
// ground"; rails only on bridges and drops). No road file carries a verge band yet, so each one is
// derived from the road's tags and barriers. They must agree with what render draws there: ground
// wherever render draws land, a water edge wherever it draws the sea, a rail wherever a rail barrier
// stands. And every two-way section carries 1 to 3 drive lanes per direction.

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function roads(): [string, BakedRoad][] {
  const out: [string, BakedRoad][] = [];
  for (const pack of readdirSync(path.join(root, 'packs'))) {
    const regions = path.join(root, 'packs', pack, 'regions');
    if (!existsSync(regions)) continue;
    for (const region of readdirSync(regions)) {
      const dir = path.join(regions, region, 'roads');
      if (!existsSync(dir)) continue;
      for (const f of readdirSync(dir).filter((x) => x.endsWith('.json'))) {
        out.push([
          `${pack}/${region}/${f}`,
          JSON.parse(readFileSync(path.join(dir, f), 'utf8')) as BakedRoad,
        ]);
      }
    }
  }
  return out;
}

/** Every 25 m along a road, plus every tag and barrier boundary (and just inside each). */
function stations(road: BakedRoad): number[] {
  const at = new Set<number>();
  for (let s = 0; s <= road.lengthM; s += 25) at.add(s);
  for (const r of [...(road.tags ?? []), ...(road.barriers ?? [])]) {
    for (const s of [r.s0, r.s0 + 0.5, r.s1 - 0.5, r.s1]) if (s >= 0 && s <= road.lengthM) at.add(s);
  }
  return [...at].sort((a, b) => a - b);
}

function sectionAt(road: BakedRoad, s: number) {
  let found = road.laneSections[0];
  for (const sec of road.laneSections) if (sec.s0 <= s) found = sec;
  if (!found) throw new Error(`${road.id} has no lane sections`);
  return found;
}

describe('derived verges on every live road', () => {
  const all = roads();

  it('agree with what render draws beside the road', () => {
    const wrong: string[] = [];
    let checked = 0;
    let ground = 0;
    let water = 0;
    let rail = 0;
    for (const [file, road] of all) {
      // A connector road or a shortcut ribbon with no tags of its own: render dresses it as palm land
      // like any untagged road, and so does the derivation (checked like the rest).
      for (const s of stations(road)) {
        for (const side of ['left', 'right'] as const) {
          const v = resolveVerge(road, sectionAt(road, s), side, s);
          const theme = themeAt(road.tags, side, s);
          const railed = (road.barriers ?? []).some(
            (b) => b.kind === 'rail' && s >= b.s0 && s <= b.s1 && (b.side === side || b.side === 'both'),
          );
          const walled = (road.barriers ?? []).some(
            (b) => b.kind === 'wall' && s >= b.s0 && s <= b.s1 && (b.side === side || b.side === 'both'),
          );
          checked++;
          const where = `${file} s=${s} ${side}`;
          if (railed) {
            rail++;
            if (v.edge !== 'rail') wrong.push(`${where}: rail barrier, edge ${v.edge}`);
          } else if (walled) {
            if (v.edge !== 'hard' || v.widthM !== 0)
              wrong.push(`${where}: wall barrier, ${v.edge} ${v.widthM} m`);
          } else if (theme === 'water') {
            water++;
            if (v.edge !== 'water') wrong.push(`${where}: render draws sea, edge ${v.edge}`);
          } else if (theme !== 'none') {
            ground++;
            if (!(v.widthM > 0)) wrong.push(`${where}: render draws ${theme} land, no verge band`);
          }
        }
      }
    }
    console.log(
      `[examined] ${checked} road stations (both sides) on ${all.length} roads: ${ground} beside drawn land, ${water} beside the sea, ${rail} on a rail`,
    );
    expect(all.length).toBeGreaterThan(40);
    expect(ground).toBeGreaterThan(1000);
    expect(water).toBeGreaterThan(50);
    expect(rail).toBeGreaterThan(50);
    expect(wrong.slice(0, 20)).toEqual([]);
  });

  it('every two-way section carries 1 to 3 drive lanes per direction', () => {
    const bad: string[] = [];
    for (const [file, road] of all) {
      road.laneSections.forEach((sec, i) => {
        const { forward, oncoming } = lanesPerDirection(sec.lanes);
        if (forward > 0 && oncoming > 0 && (forward > 3 || oncoming > 3)) bad.push(`${file} section ${i}`);
      });
    }
    expect(bad).toEqual([]);
  });
});
