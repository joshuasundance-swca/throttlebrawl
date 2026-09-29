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
    expect(lookup(reg.bikes, 'rustbucket-400').handling.topSpeedMps).toBeCloseTo(38.0);
    expect(lookup(reg.riders, 'deacon-vane').role).toBe('rival');
    expect(Object.keys(reg.roads).sort()).toEqual([
      'base:m1-marina-run',
      'base:m1-pelican-bridge',
      'base:m1-sandbar-causeway',
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

  it('keeps presentation edits out of the sim content hash (interim hashes)', () => {
    const before = contentHashes(buildRegistry(basePackFiles()));
    const blurb = contentHashes(
      buildRegistry(
        edited('riders/deacon-vane.json', (j) => {
          j['blurb'] = 'Still a preacher.';
        }),
      ),
    );
    const handling = contentHashes(
      buildRegistry(
        edited('bikes/rustbucket-400.json', (j) => {
          (j['handling'] as Record<string, unknown>)['accelMps2'] = 5;
        }),
      ),
    );
    expect(blurb.full).not.toBe(before.full);
    expect(blurb.sim).toBe(before.sim);
    expect(handling.full).not.toBe(before.full);
    expect(handling.sim).not.toBe(before.sim);
  });
});
