/// <reference types="vite/client" />
// Reachability in the packs (the quality retro's recommendation 4, the "built but not reachable"
// class: skeptic-1c's "No live track has slots yet", and content that works in a dev build but is
// left out of the public one). The code-side checks (tuning, key and pad bindings) are in
// src/app/reachability.test.ts.
//
// 1. Every set-piece slot on every road network in the packs has 2 or more candidates, so the race
//    seed really moves it (docs/content-packs.md, "Placed by the race seed"). The networks come from
//    the packs, not a hand list, so a new network is checked the day it lands.
// 2. Everything live is live in the prod channel: no live entry names a `draft` one. The content
//    lint only warns about that (release builds leave drafts out, so the reference resolves to
//    nothing in the public game), so this file holds the warnings to a named list that can only
//    shrink: a new one fails, and so does a fixed one still on the list.
// Each check is shown to fire on a deliberately broken input.
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { lintPacks, parsePack, registryFromGlob, type PackFile, type ParsedPack } from '../../src/content';
import { setPieceSlots, type BakedFeature } from '../../src/road';
import { ALL_TUNING } from './tuning';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

// ---------------------------------------------------------------------------------------------
// 1. Set-piece slots
// ---------------------------------------------------------------------------------------------

/** The prod registry (drafts left out, as the public build loads it). */
const REG = registryFromGlob(
  import.meta.glob<unknown>('/packs/*/**/*.json', { eager: true, import: 'default' }),
);

type Edge = { readonly id: string; readonly features: readonly BakedFeature[] };

/** Each road network's roads as the slot picker sees them (an edge per road, its features). */
function networkEdges(): Map<string, Edge[]> {
  const out = new Map<string, Edge[]>();
  for (const [qid, road] of Object.entries(REG.roads)) {
    const pack = qid.slice(0, qid.indexOf(':'));
    const net = `${pack}:${road.network}`;
    const features: BakedFeature[] = (road.features ?? []).map((f) => {
      const params = f['params'];
      return {
        kind: f.kind,
        id: f.id,
        s0: f.s0,
        s1: f.s1,
        d0: f.d0,
        d1: f.d1,
        params:
          typeof params === 'object' && params !== null ? (params as Record<string, unknown>) : undefined,
      };
    });
    const list = out.get(net) ?? [];
    list.push({ id: qid, features });
    out.set(net, list);
  }
  return out;
}

/** `network slot: n candidate(s)` for every slot with fewer than two. */
function thinSlots(networks: ReadonlyMap<string, readonly Edge[]>): string[] {
  const out: string[] = [];
  for (const [net, edges] of networks)
    for (const [slot, ids] of setPieceSlots(edges))
      if (ids.length < 2) out.push(`${net} ${slot}: ${ids.length} candidate (${ids.join(', ')})`);
  return out.sort();
}

describe('reachability: every set-piece slot in the packs has 2 or more candidates', () => {
  it('on every road network the packs ship', () => {
    const networks = networkEdges();
    let slots = 0;
    let withSlots = 0;
    for (const edges of networks.values()) {
      const n = setPieceSlots(edges).size;
      slots += n;
      if (n > 0) withSlots++;
    }
    process.stdout.write(
      `[examined] ${networks.size} road networks (${Object.keys(REG.networks).length} network files), ${withSlots} with set-piece slots, ${slots} slots\n`,
    );
    // Every network file has roads here, or the grouping examined the wrong thing.
    expect(networks.size).toBe(Object.keys(REG.networks).length);
    expect(slots).toBeGreaterThan(0);
    expect(thinSlots(networks)).toEqual([]);
  });

  it('fires on a slot left with one candidate (a real network with one spot taken out)', () => {
    const networks = networkEdges();
    const [net, edges] = [...networks].find(([, e]) => setPieceSlots(e).size > 0) ?? ['', []];
    const [slot, ids] = [...setPieceSlots(edges)][0] ?? ['', []];
    const drop = ids[0];
    const broken = new Map(networks);
    broken.set(
      net,
      edges.map((e) => ({ ...e, features: e.features.filter((f) => f.id !== drop) })),
    );
    expect(thinSlots(broken)).toEqual([
      `${net} ${slot}: ${ids.length - 1} candidate (${ids.filter((id) => id !== drop).join(', ')})`,
    ]);
  });
});

// ---------------------------------------------------------------------------------------------
// 2. Live means live in prod
// ---------------------------------------------------------------------------------------------

/**
 * The live references to drafts on main, as `file pointer -> target`. This list may only shrink:
 * flip the type to live (or drop the reference) and remove its line here in the same PR. Never add
 * a line. Empty since 2026-10-03, when the Keys' five traffic-4 animals and oddities (iguana,
 * pelican, gator, gator on a lawn chair, runaway mobile home) went live; it held all five when this
 * check landed earlier that day.
 */
const KNOWN_LIVE_TO_DRAFT: readonly string[] = [];

/** Every pack folder's files, parsed (as packs:check reads them). */
function readPacks(): { dir: string; files: PackFile[] }[] {
  const list = (dir: string, base = ''): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
      const rel = base ? `${base}/${d.name}` : d.name;
      if (d.isDirectory()) return list(path.join(dir, d.name), rel);
      return d.isFile() && d.name.endsWith('.json') ? [rel] : [];
    });
  const packs = path.join(ROOT, 'packs');
  return readdirSync(packs, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => ({
      dir: `packs/${d.name}`,
      files: list(path.join(packs, d.name)).map((rel) => ({
        path: rel,
        json: JSON.parse(readFileSync(path.join(packs, d.name, rel), 'utf8')) as unknown,
      })),
    }));
}

/** The content lint's "points at the draft" findings, as `file pointer -> target`, deduplicated. */
function liveToDraft(packs: readonly { dir: string; files: PackFile[] }[]): string[] {
  const parsed: { dir: string; pack: ParsedPack }[] = [];
  for (const p of packs) {
    const { pack } = parsePack(p.files);
    if (pack) parsed.push({ dir: p.dir, pack });
  }
  const out = new Set<string>();
  for (const f of lintPacks(
    parsed.map((p) => p.pack),
    { tuning: ALL_TUNING },
  )) {
    const m = /^points at the draft (.+?); release builds leave drafts out/.exec(f.message);
    if (!m) continue;
    const owner = parsed.find((p) => p.pack.entries.some((e) => e.path === f.file));
    out.add(`${owner?.dir ?? 'packs'}/${f.file} ${f.pointer} -> ${m[1] ?? ''}`);
  }
  return [...out].sort();
}

describe('reachability: no live entry names a draft (live in dev, missing in prod)', () => {
  const packs = readPacks();

  it('holds to the known list, which may only shrink', () => {
    const found = liveToDraft(packs);
    process.stdout.write(
      `[examined] ${packs.reduce((n, p) => n + p.files.length, 0)} pack JSON files in ${packs.length} packs; ${found.length} live references to drafts (known ${KNOWN_LIVE_TO_DRAFT.length})\n`,
    );
    const added = found.filter((x) => !KNOWN_LIVE_TO_DRAFT.includes(x));
    const fixed = KNOWN_LIVE_TO_DRAFT.filter((x) => !found.includes(x));
    expect(added, 'new live references to drafts: make the target live, or leave it out').toEqual([]);
    expect(fixed, 'fixed: take these lines off KNOWN_LIVE_TO_DRAFT').toEqual([]);
  });

  it('fires on a live reference to a draft (a live traffic type the Keys use, flipped to draft)', () => {
    const broken = packs.map((p) => ({
      ...p,
      files: p.files.map((f) => {
        if (p.dir !== 'packs/base' || f.path !== 'traffic/pickup.json') return f;
        const json = structuredClone(f.json) as { meta?: Record<string, unknown> };
        json.meta = { ...json.meta, status: 'draft' };
        return { ...f, json };
      }),
    }));
    const added = liveToDraft(broken).filter((x) => !KNOWN_LIVE_TO_DRAFT.includes(x));
    expect(added).toContain(
      'packs/base/regions/florida-keys/region.json /traffic/mix/1/kind -> traffic-type "pickup"',
    );
  });
});
