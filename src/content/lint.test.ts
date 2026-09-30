// Every lint rule has a passing fixture and a failing one (M1 content-1, automated acceptance).
// The passing fixture is the real base pack plus the files a case adds; each failing fixture is
// one edit away from it.
import { describe, expect, it } from 'vitest';
import type { TuningParamDecl } from '../core';
import { basePackFiles } from './base-pack';
import { formatFinding, lintPacks, parsePack, type Finding, type PackFile, type PackRule } from './index';

type Json = Record<string, unknown>;

const TUNING: TuningParamDecl[] = [
  {
    id: 'camera.chaseDistanceM',
    group: 'camera',
    label: 'Chase distance',
    default: 6.5,
    min: 3,
    max: 12,
    step: 0.1,
    unit: 'm',
    affectsSim: false,
  },
];

const PIPE: Json = {
  type: 'weapon',
  id: 'lead-pipe',
  name: 'Lead Pipe',
  category: 'blunt',
  behaviour: 'melee.swing',
  unarmed: false,
  reach: { sM: 1.6, dM: 1.4 },
  windupS: 0.34,
  activeS: 0.1,
  recoveryS: 0.42,
  damage: 18,
  steal: { allowed: true, windowStartS: 0.12, windowEndS: 0.34 },
};

const PRESET: Json = {
  type: 'tuning-preset',
  id: 'long-cam',
  name: 'Long cam',
  base: 'registry',
  values: { 'camera.chaseDistanceM': 8 },
};

/** The base pack with files added or replaced (by path) and edits applied. */
function pack(
  add: Record<string, unknown> = {},
  edit: Record<string, (json: Json) => void> = {},
): PackFile[] {
  const files = basePackFiles()
    .filter((f) => !(f.path in add))
    .map((f) => {
      const fn = edit[f.path];
      if (!fn) return f;
      const json = structuredClone(f.json) as Json;
      fn(json);
      return { path: f.path, json };
    });
  for (const [path, json] of Object.entries(add)) files.push({ path, json });
  return files;
}

function run(files: PackFile[], rules: PackRule[] = []): Finding[] {
  const parsed = parsePack(files);
  if (!parsed.pack) return parsed.findings;
  return [...parsed.findings, ...lintPacks([parsed.pack], { tuning: TUNING, rules })];
}

function errors(files: PackFile[], rule?: string, rules: PackRule[] = []): string[] {
  return run(files, rules)
    .filter((f) => f.level === 'error' && (!rule || f.rule === rule))
    .map((f) => formatFinding(f));
}

describe('content lint: the passing fixture', () => {
  it('the base pack plus a pickup weapon and a tuning preset has no errors', () => {
    const files = pack({ 'weapons/lead-pipe.json': PIPE, 'tuning/long-cam.json': PRESET });
    expect(errors(files)).toEqual([]);
  });
});

describe('content lint: schema', () => {
  it('fails a bad field with the file and a JSON pointer', () => {
    const files = pack({}, { 'bikes/rustbucket-400.json': (j) => ((j['handling'] as Json)['massKg'] = 0) });
    expect(errors(files, 'schema')).toEqual([
      expect.stringMatching(/^bikes\/rustbucket-400\.json \/handling\/massKg: /),
    ]);
  });

  it('fails an unknown type and a reserved type that is not loaded yet', () => {
    const files = pack({
      'misc/thing.json': { type: 'gizmo', id: 'thing' },
      'patches/heavier.json': { type: 'patch', id: 'heavier', target: 'base:lead-pipe', merge: {} },
    });
    const found = errors(files, 'schema');
    expect(found).toContainEqual(expect.stringMatching(/misc\/thing\.json \/type: unknown entry type gizmo/));
    expect(found).toContainEqual(expect.stringMatching(/patches\/heavier\.json \/type: .*reserved/));
  });

  it('refuses a pack format it cannot read', () => {
    const files = pack({}, { 'pack.json': (j) => (j['formatVersion'] = 2) });
    expect(errors(files)).toEqual([expect.stringMatching(/pack\.json \/formatVersion: .*needs format 2/)]);
  });
});

describe('content lint: references', () => {
  it('fails a reference to a missing entry of the right type', () => {
    const files = pack({}, { 'riders/deacon-vane.json': (j) => (j['bike'] = 'no-such-bike') });
    expect(errors(files, 'refs')).toEqual([
      expect.stringMatching(/riders\/deacon-vane\.json \/bike: .*no bike "no-such-bike"/),
    ]);
  });

  it('fails a reference to an entry of the wrong type', () => {
    const files = pack({}, { 'riders/deacon-vane.json': (j) => (j['bike'] = 'player') });
    expect(errors(files, 'refs')).toHaveLength(1);
  });

  it('fails a live reference to a vetoed or a draft entry', () => {
    const vetoed = pack({}, { 'bikes/rustbucket-400.json': (j) => (j['meta'] = { status: 'vetoed' }) });
    expect(errors(vetoed, 'refs')).toContainEqual(expect.stringMatching(/\/bike: .*vetoed/));
    const draft = pack({}, { 'bikes/rustbucket-400.json': (j) => (j['meta'] = { status: 'draft' }) });
    expect(errors(draft, 'refs')).toContainEqual(expect.stringMatching(/\/bike: .*draft/));
  });

  it('accepts a qualified reference into its own pack and fails one into an undeclared pack', () => {
    const own = pack({}, { 'riders/deacon-vane.json': (j) => (j['bike'] = 'base:rustbucket-400') });
    expect(errors(own, 'refs')).toEqual([]);
    const other = pack({}, { 'riders/deacon-vane.json': (j) => (j['bike'] = 'region-pnw:logger-750') });
    expect(errors(other, 'refs')).toEqual([
      expect.stringMatching(/\/bike: .*pack "region-pnw" is not in this pack's dependencies/),
    ]);
  });

  it('fails a cop agency that is not a law crew', () => {
    const cop: Json = {
      type: 'rider',
      id: 'sgt-pruitt',
      name: 'Sgt. Pruitt',
      role: 'cop',
      bike: 'rustbucket-400',
      law: { agency: 'swamp-kin', bustRadiusM: 14, bustDwellS: 1, fineCash: 400, pursuitSpeedScale: 1.05 },
    };
    const crew = (kind: string): Json => ({ type: 'crew', id: 'swamp-kin', name: 'Swamp Kin', kind });
    expect(
      errors(pack({ 'riders/sgt-pruitt.json': cop, 'crews/swamp-kin.json': crew('law') }), 'refs'),
    ).toEqual([]);
    expect(
      errors(pack({ 'riders/sgt-pruitt.json': cop, 'crews/swamp-kin.json': crew('gang') }), 'refs'),
    ).toEqual([expect.stringMatching(/\/law\/agency: .*kind "law"/)]);
  });

  it('fails a pack default that names a missing HUD layout or tuning preset', () => {
    const files = pack({}, { 'pack.json': (j) => (j['defaults'] = { tuning: 'nope', hud: 'gone' }) });
    expect(errors(files, 'refs')).toHaveLength(2);
    const ok = pack(
      { 'tuning/long-cam.json': PRESET },
      { 'pack.json': (j) => (j['defaults'] = { tuning: 'long-cam', hud: 'classic' }) },
    );
    expect(errors(ok, 'refs')).toEqual([]);
  });

  it('fails a road billboard slot that names a vetoed or missing region item', () => {
    const region = 'regions/florida-keys/region.json';
    const road = 'regions/florida-keys/roads/m1-marina-run.json';
    const slot = (item: string) => (j: Json) => {
      j['features'] = [{ kind: 'billboard', id: 'bb-1', s0: 100, s1: 120, d0: 6, d1: 9, item }];
    };
    const withBoards = (j: Json) => {
      j['billboards'] = [
        { id: 'timeshare', text: 'OWN A PIECE OF PARADISE.' },
        { id: 'old-joke', text: 'OLD JOKE.', status: 'vetoed', note: 'stale' },
      ];
    };
    expect(errors(pack({}, { [region]: withBoards, [road]: slot('timeshare') }), 'refs')).toEqual([]);
    expect(errors(pack({}, { [region]: withBoards, [road]: slot('old-joke') }), 'refs')).toEqual([
      expect.stringMatching(/\/features\/0\/item: .*vetoed/),
    ]);
    expect(errors(pack({}, { [region]: withBoards, [road]: slot('nothing') }), 'refs')).toHaveLength(1);
  });
});

describe('content lint: bark speakers and targets', () => {
  const barks = (speaker: string, target = 'any') => ({
    'barks/probe.json': {
      type: 'bark-set',
      id: 'probe',
      defaults: { speaker },
      lines: [{ id: 'probe-1', trigger: 'overtake', target, text: 'Move.' }],
    },
  });
  const refs = (files: PackFile[]) =>
    run(files).filter((f) => f.rule === 'refs' && f.file === 'barks/probe.json');

  it('accepts a rider id or a selector as speaker and target', () => {
    expect(refs(pack(barks('deacon-vane', 'player')))).toEqual([]);
    expect(refs(pack(barks('role:cop', 'tag:smoker')))).toEqual([]);
  });

  it('warns, without failing, on a speaker whose rider is missing (the line stays silent)', () => {
    const found = refs(pack(barks('nobody-yet', 'also-nobody')));
    expect(found.map((f) => [f.level, f.pointer])).toEqual([
      ['warning', '/defaults/speaker'],
      ['warning', '/lines/0/target'],
    ]);
  });
});

describe('content lint: ids', () => {
  it('fails a filename that differs from the id', () => {
    const files = pack({}, { 'riders/player.json': (j) => (j['id'] = 'someone-else') });
    expect(errors(files, 'ids')).toEqual([expect.stringMatching(/riders\/player\.json \/id: filename/)]);
  });

  it('fails two entries of one type with the same id', () => {
    const copy = structuredClone(basePackFiles().find((f) => f.path === 'bikes/rustbucket-400.json')?.json);
    const files = pack({ 'bikes/spares/rustbucket-400.json': copy });
    expect(errors(files, 'ids')).toContainEqual(expect.stringMatching(/duplicate bike id rustbucket-400/));
  });

  it('fails a file whose type does not match its folder', () => {
    const files = pack({ 'bikes/lead-pipe.json': PIPE });
    expect(errors(files, 'ids')).toContainEqual(
      expect.stringMatching(/bikes\/lead-pipe\.json \/type: .*weapons\//),
    );
  });

  it('checks idAliases: target exists, no chains, no reuse of a retired id', () => {
    const aliases = (map: Record<string, string>) => (j: Json) => (j['idAliases'] = map);
    expect(errors(pack({}, { 'pack.json': aliases({ 'old-deacon': 'deacon-vane' }) }), 'ids')).toEqual([]);
    expect(errors(pack({}, { 'pack.json': aliases({ 'old-deacon': 'nobody' }) }), 'ids')).toHaveLength(1);
    expect(errors(pack({}, { 'pack.json': aliases({ a: 'b', b: 'deacon-vane' }) }), 'ids')).toContainEqual(
      expect.stringMatching(/chain/),
    );
    expect(errors(pack({}, { 'pack.json': aliases({ player: 'deacon-vane' }) }), 'ids')).toContainEqual(
      expect.stringMatching(/still in use/),
    );
  });

  it('fails vetoable item ids repeated inside one entry', () => {
    const files = pack(
      {},
      {
        'regions/florida-keys/region.json': (j) => {
          j['signs'] = [{ id: 'next-regret', text: 'NEXT REGRET 2 MI.' }];
          j['billboards'] = [{ id: 'next-regret', text: 'AGAIN.' }];
        },
      },
    );
    expect(errors(files, 'ids')).toEqual([expect.stringMatching(/\/billboards\/0\/id: .*next-regret/)]);
  });
});

describe('content lint: public safety', () => {
  it('fails the banned name in display text and ids', () => {
    const name = pack({}, { 'riders/deacon-vane.json': (j) => (j['name'] = 'Road Rash Deacon') });
    expect(errors(name, 'public-safety')).toEqual([expect.stringMatching(/deacon-vane\.json \/name: /)]);
    const sign = pack(
      {},
      {
        'regions/florida-keys/region.json': (j) =>
          (j['signs'] = [{ id: 'homage', text: 'WELCOME TO ROAD-RASH COUNTY' }]),
      },
    );
    expect(errors(sign, 'public-safety')).toEqual([expect.stringMatching(/\/signs\/0\/text: /)]);
  });

  it('accepts roles and tool paths as authors, and fails anything that looks like a person', () => {
    const author = (who: string) => (j: Json) =>
      (j['meta'] = { provenance: { origin: 'agent', author: who } });
    for (const who of ['agent', 'maintainer', 'tools/gis']) {
      expect(errors(pack({}, { 'riders/deacon-vane.json': author(who) }), 'public-safety')).toEqual([]);
    }
    expect(errors(pack({}, { 'riders/deacon-vane.json': author('Jane Smith') }), 'public-safety')).toEqual([
      expect.stringMatching(/\/meta\/provenance\/author: /),
    ]);
    const packAuthors = pack({}, { 'pack.json': (j) => (j['authors'] = ['the maintainer', 'jsmith99']) });
    expect(errors(packAuthors, 'public-safety')).toEqual([
      expect.stringMatching(/pack\.json \/authors\/1: /),
    ]);
  });
});

describe('content lint: the steal window, in ticks', () => {
  const weapon = (steal: Json, extra: Json = {}) => ({
    'weapons/lead-pipe.json': { ...PIPE, ...extra, steal: { allowed: true, ...steal } },
  });

  it('passes a window inside the wind-up', () => {
    expect(errors(pack(weapon({ windowStartS: 0, windowEndS: 0.34 })), 'steal-window')).toEqual([]);
  });

  it('fails a window that ends after the wind-up', () => {
    expect(errors(pack(weapon({ windowStartS: 0.12, windowEndS: 0.4 })), 'steal-window')).toEqual([
      expect.stringMatching(/weapons\/lead-pipe\.json \/steal\/windowEndS: .*tick 24 .*wind-up.*20 ticks/),
    ]);
  });

  it('fails a window that rounds to nothing', () => {
    expect(errors(pack(weapon({ windowStartS: 0.12, windowEndS: 0.121 })), 'steal-window')).toHaveLength(1);
  });

  it('fails a stealable unarmed attack', () => {
    const punch = weapon({ windowStartS: 0, windowEndS: 0.1 }, { unarmed: true, category: 'unarmed' });
    expect(errors(pack(punch), 'steal-window')).toEqual([expect.stringMatching(/\/steal\/allowed: /)]);
  });
});

describe('content lint: tuning keys', () => {
  it('fails an unknown key and a value out of range', () => {
    const preset = (values: Json) => ({ 'tuning/long-cam.json': { ...PRESET, values } });
    expect(errors(pack(preset({ 'camera.chaseDistanceM': 8 })), 'tuning-keys')).toEqual([]);
    expect(errors(pack(preset({ 'camera.zoomy': 1 })), 'tuning-keys')).toEqual([
      expect.stringMatching(/\/values\/camera\.zoomy: unknown tuning key/),
    ]);
    expect(errors(pack(preset({ 'camera.chaseDistanceM': 40 })), 'tuning-keys')).toEqual([
      expect.stringMatching(/\/values\/camera\.chaseDistanceM: 40 is outside 3\.\.12/),
    ]);
  });

  it('fails a preset whose base is neither registry nor a preset', () => {
    expect(errors(pack({ 'tuning/long-cam.json': { ...PRESET, base: 'nope' } }), 'refs')).toHaveLength(1);
  });
});

describe('content lint: extra rules (the road lane hook)', () => {
  const rule: PackRule = {
    id: 'road-demo',
    // A threshold no real road reaches, so the test does not depend on the track's data.
    description: 'every road is shorter than 1000 km',
    check: (ctx) =>
      ctx.entries('road').flatMap((e) =>
        (e.data['lengthM'] as number) >= 1_000_000
          ? [
              {
                level: 'error' as const,
                rule: 'road-demo',
                file: e.path,
                pointer: '/lengthM',
                message: 'too long',
              },
            ]
          : [],
      ),
  };

  it('runs a hooked rule over the parsed packs', () => {
    expect(errors(pack(), 'road-demo', [rule])).toEqual([]);
    const road = basePackFiles().find((f) => (f.json as Json)['type'] === 'road')?.path ?? '';
    const long = pack({}, { [road]: (j) => (j['lengthM'] = 2_000_000) });
    expect(errors(long, 'road-demo', [rule])).toEqual([`${road} /lengthM: too long`]);
  });
});
