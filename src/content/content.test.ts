import { describe, expect, it } from 'vitest';
import { basePackFiles, buildRegistry, contentHashes, loadBasePack, lookup, type PackFile } from './index';

function edited(path: string, edit: (json: Record<string, unknown>) => void): PackFile[] {
  return basePackFiles().map((f) => {
    if (f.path !== path) return f;
    const json = structuredClone(f.json) as Record<string, unknown>;
    edit(json);
    return { path: f.path, json };
  });
}

describe('content: the base pack', () => {
  it('loads and validates every M1 file the skeleton ships', () => {
    const reg = loadBasePack();
    expect(reg.packs[0]?.id).toBe('base');
    expect(lookup(reg.bikes, 'rustbucket-400').handling.topSpeedMps).toBeCloseTo(44.7);
    expect(lookup(reg.riders, 'deacon-vane').role).toBe('rival');
    // The hand-made roads; the GIS side quest adds osm- prefixed roads beside them.
    const handMade = Object.keys(reg.roads).filter((k) => !k.startsWith('base:osm-'));
    expect(handMade.sort()).toEqual([
      'base:c-boat-ramp-in',
      'base:c-boat-ramp-out',
      'base:c-marina-merge-main',
      'base:c-marina-split-main',
      'base:m1-boat-ramp-cut',
      'base:m1-conch-row',
      'base:m1-last-resort-causeway',
      'base:m1-long-bridge',
      'base:m1-mangrove-cut',
      'base:m1-marina-bends',
      'base:m1-marina-run',
      'base:m1-pelican-bridge',
      'base:m1-sandbar-causeway',
      'base:m1-tarpon-flats',
    ]);
    expect(reg.index.length).toBe(basePackFiles().length - 1);
    expect(Object.isFrozen(lookup(reg.bikes, 'rustbucket-400').handling)).toBe(true);
  });

  it('names the file and the JSON pointer of a bad field', () => {
    const files = edited('bikes/rustbucket-400.json', (j) => {
      (j['handling'] as Record<string, unknown>)['topSpeedMps'] = -1;
    });
    expect(() => buildRegistry(files)).toThrow(/bikes\/rustbucket-400\.json \/handling\/topSpeedMps/);
  });

  it('requires the filename to equal the id', () => {
    const files = edited('riders/player.json', (j) => {
      j['id'] = 'someone-else';
    });
    expect(() => buildRegistry(files)).toThrow(/filename must equal the id/);
  });

  it('skips vetoed entries but keeps them in the index (the taste log)', () => {
    const files = edited('riders/deacon-vane.json', (j) => {
      j['meta'] = { status: 'vetoed' };
    });
    const reg = buildRegistry(files);
    expect(reg.riders['base:deacon-vane']).toBeUndefined();
    expect(reg.index.some((r) => r.id === 'deacon-vane')).toBe(true);
  });

  it('refuses a pack format it cannot read', () => {
    const files = edited('pack.json', (j) => {
      j['formatVersion'] = 2;
    });
    expect(() => buildRegistry(files)).toThrow(/needs format 2/);
  });

  it('drops vetoed items (and drafts in release builds) but keeps them in the file', () => {
    const files = edited('regions/florida-keys/region.json', (j) => {
      j['signs'] = [
        { id: 'ices-before-road', text: 'BRIDGE ICES BEFORE ROAD. IT IS 91 DEGREES.' },
        { id: 'stale', text: 'STALE JOKE.', status: 'vetoed', note: 'cut by the maintainer' },
        { id: 'maybe', text: 'MAYBE.', status: 'draft' },
      ];
    });
    const ids = (includeDrafts: boolean) =>
      (lookup(buildRegistry(files, { includeDrafts }).regions, 'florida-keys').signs ?? []).map((s) => s.id);
    expect(ids(false)).toEqual(['ices-before-road']);
    expect(ids(true)).toEqual(['ices-before-road', 'maybe']);
  });
});

describe('content: the sim and full content hashes', () => {
  const BARKS = {
    type: 'bark-set',
    id: 'hash-probe',
    defaults: { speaker: 'deacon-vane' },
    lines: [{ id: 'deacon-pass', trigger: 'overtake', target: 'any', text: 'Pray for traction.' }],
  };
  const withBarks = (text: string): PackFile[] => [
    ...basePackFiles(),
    { path: 'barks/hash-probe.json', json: { ...BARKS, lines: [{ ...BARKS.lines[0], text }] } },
  ];
  const hashes = (files: PackFile[]) => contentHashes(buildRegistry(files));
  const base = hashes(withBarks('Pray for traction.'));

  it('is stable for the same content and 8 hex digits each', () => {
    expect(hashes(withBarks('Pray for traction.'))).toEqual(base);
    expect(base.sim).toMatch(/^[0-9a-f]{8}$/);
    expect(base.full).toMatch(/^[0-9a-f]{8}$/);
  });

  it('editing a bark changes the full hash but not the sim hash', () => {
    const bark = hashes(withBarks('Traction is a state of grace.'));
    expect(bark.full).not.toBe(base.full);
    expect(bark.sim).toBe(base.sim);
  });

  it("editing a bike's handling changes both hashes", () => {
    const files = [
      ...edited('bikes/rustbucket-400.json', (j) => {
        (j['handling'] as Record<string, unknown>)['accelMps2'] = 5;
      }),
      { path: 'barks/hash-probe.json', json: BARKS },
    ];
    const h = hashes(files);
    expect(h.full).not.toBe(base.full);
    expect(h.sim).not.toBe(base.sim);
  });

  it("editing a bike's paint changes only the full hash", () => {
    const files = [
      ...edited('bikes/rustbucket-400.json', (j) => {
        j['look'] = { paintSlots: ['body'], defaultPaint: { body: '#f2c14e' }, paintOptions: ['#f2c14e'] };
      }),
      { path: 'barks/hash-probe.json', json: BARKS },
    ];
    const h = hashes(files);
    expect(h.full).not.toBe(base.full);
    expect(h.sim).toBe(base.sim);
  });

  it("editing a rider's blurb or paint changes only the full hash; its stats change both", () => {
    const blurb = hashes([
      ...edited('riders/deacon-vane.json', (j) => {
        j['blurb'] = 'Still a preacher.';
        j['paint'] = { body: '#000000' };
      }),
      { path: 'barks/hash-probe.json', json: BARKS },
    ]);
    expect(blurb.full).not.toBe(base.full);
    expect(blurb.sim).toBe(base.sim);
    const stats = hashes([
      ...edited('riders/deacon-vane.json', (j) => {
        j['stats'] = { massKg: 96 };
      }),
      { path: 'barks/hash-probe.json', json: BARKS },
    ]);
    expect(stats.sim).not.toBe(base.sim);
  });

  it('a vetoed bark line changes the full hash, since the registry drops it', () => {
    const files = [
      ...basePackFiles(),
      {
        path: 'barks/hash-probe.json',
        json: { ...BARKS, lines: [{ ...BARKS.lines[0], status: 'vetoed' }] },
      },
    ];
    const h = hashes(files);
    expect(h.full).not.toBe(base.full);
    expect(h.sim).toBe(base.sim);
  });

  it('does not depend on the order the files arrive in', () => {
    expect(hashes([...withBarks('Pray for traction.')].reverse())).toEqual(base);
  });
});
