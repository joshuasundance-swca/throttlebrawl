import { describe, expect, it } from 'vitest';
import { wholeBasePackFiles } from '../../src/content/base-pack-whole';
import { formatFinding, lintPacks, parsePack, type PackFile } from '../../src/content';
import { packRules } from './pack-rules';

// W-Q contracts (interview, 2026-10-02: "Network map, tiered"; "The map": claim roads, find secrets
// and shortcuts, a set-piece finale per region): a career file is a region's map, and the lint
// checks it against the region's real networks. The passing fixture is the real base pack plus a
// two-tier Keys career over its real events and roads; each failing case is one edit away.

type Json = Record<string, unknown>;

const SPRINT = 'events/m1-skeleton-sprint.json';
const base = () => wholeBasePackFiles();
const sprint = () => structuredClone(base().find((f) => f.path === SPRINT)?.json) as Json;

const BOSS_EVENT: Json = {
  ...sprint(),
  id: 'keys-test-boss',
  name: 'Mother of All Grudges',
  kind: 'grudge-match',
  rules: { rival: 'deacon-vane', winBy: 'knockdowns', knockdownsToWin: 2, grudgeStakes: 3 },
  objectives: [{ id: 'beat-deacon', kind: 'beat-rival', required: true }],
  tier: 2,
  finale: true,
};

const CAREER: Json = {
  type: 'career',
  id: 'keys-test-circuit',
  name: 'The Keys Test Circuit',
  region: 'florida-keys',
  startingCash: 500,
  startingBike: 'rustbucket-400',
  firstRun: 'race-first',
  tiers: [
    { id: 't1', name: 'Tourist Season', advance: { requiredWins: 1 } },
    { id: 't2', name: 'Hurricane Season', advance: { requiredWins: 1 } },
  ],
  nodes: [
    {
      id: 'causeway-sprint',
      event: 'm1-skeleton-sprint',
      length: 'standard',
      tier: 't1',
      at: { road: 'm1-marina-run', s: 40 },
      opens: ['m1-pelican-bridge'],
      claims: ['m1-marina-run'],
    },
    {
      id: 'the-grudge',
      event: 'keys-test-boss',
      tier: 't2',
      at: { road: 'm1-long-bridge', s: 10 },
      requires: ['causeway-sprint'],
    },
  ],
  boss: 'the-grudge',
  secrets: [
    {
      id: 'boat-ramp',
      kind: 'shortcut',
      at: { road: 'm1-boat-ramp-cut', s: 5 },
      ref: 'm1-standard-run#m1-boat-ramp-cut',
    },
  ],
  shop: [{ bike: 'rustbucket-400', priceCash: 0, unlockTier: 't1' }],
};

function files(edit?: (career: Json, boss: Json) => void): PackFile[] {
  const career = structuredClone(CAREER);
  const boss = structuredClone(BOSS_EVENT);
  edit?.(career, boss);
  return [
    ...base(),
    { path: 'careers/keys-test-circuit.json', json: career },
    { path: 'events/keys-test-boss.json', json: boss },
  ];
}

function errors(f: PackFile[], rule?: string): string[] {
  const parsed = parsePack(f);
  const all = parsed.pack
    ? [...parsed.findings, ...lintPacks([parsed.pack], { rules: packRules })]
    : parsed.findings;
  return all.filter((x) => x.level === 'error' && (!rule || x.rule === rule)).map((x) => formatFinding(x));
}

describe('career maps', () => {
  it('a two-tier Keys career on the real roads, with a grudge-match finale, passes', () => {
    expect(errors(files())).toEqual([]);
  });

  it("refuses nodes and secrets off the region's roads, past a road's end, or opening roads elsewhere", () => {
    const found = errors(
      files((c) => {
        const [n0] = c['nodes'] as Json[];
        if (!n0) return;
        n0['at'] = { road: 'pnw-ferry-landing', s: 1 };
        n0['opens'] = ['nowhere-road'];
        (c['secrets'] as Json[])[0] = {
          id: 'boat-ramp',
          kind: 'shortcut',
          at: { road: 'm1-marina-run', s: 99999 },
        };
      }),
      'careers',
    );
    expect(found).toEqual([
      expect.stringMatching(/\/nodes\/0\/at\/road: road pnw-ferry-landing is not on florida-keys's networks/),
      expect.stringMatching(/\/nodes\/0\/opens\/0: road nowhere-road is not on florida-keys's networks/),
      expect.stringMatching(/\/secrets\/0\/at\/s: s 99999 is past the end of m1-marina-run/),
    ]);
  });

  it('refuses a boss outside the last tier or without a finale event, and a second finale', () => {
    expect(
      errors(
        files((_c, boss) => delete boss['finale']),
        'careers',
      ),
    ).toEqual([expect.stringMatching(/\/boss: the boss the-grudge's event is not marked finale: true/)]);
    const twoFinales = files((c) => {
      (c['nodes'] as Json[])[0] = { ...(c['nodes'] as Json[])[0], event: 'keys-test-boss' };
      c['boss'] = 'causeway-sprint';
    });
    const found = errors(twoFinales, 'careers');
    expect(found).toContainEqual(
      expect.stringMatching(/\/boss: the boss causeway-sprint is not in the last tier/),
    );
    expect(found).toContainEqual(
      expect.stringMatching(/node the-grudge's event is a finale, but the boss is causeway-sprint/),
    );
  });

  it('refuses unknown tiers and nodes, a later-tier requirement, a gate with too few nodes, and a wrong length', () => {
    const found = errors(
      files((c) => {
        const nodes = c['nodes'] as Json[];
        const [n0, n1] = nodes;
        if (!n0 || !n1) return;
        n0['length'] = 'marathon';
        n0['requires'] = ['the-grudge', 'ghost'];
        (c['tiers'] as Json[])[1] = { id: 't2', advance: { requiredWins: 3 } };
        nodes.push({ ...n1, id: 'stray', tier: 't9' });
      }),
      'careers',
    );
    expect(found).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/\/nodes\/2\/tier: no tier t9/),
        expect.stringMatching(/\/nodes\/0\/length: event m1-skeleton-sprint has no length marathon/),
        expect.stringMatching(/\/nodes\/0\/requires\/0: node the-grudge is in a later tier/),
        expect.stringMatching(/\/nodes\/0\/requires\/1: no node ghost/),
        expect.stringMatching(/\/tiers\/1\/advance\/requiredWins: 3 wins asked, but the tier has 1 nodes/),
      ]),
    );
  });

  it('checks the references through the refs rule: the region, the bikes and the events', () => {
    const found = errors(
      files((c) => {
        c['startingBike'] = 'hoverboard';
        (c['nodes'] as Json[])[0] = { ...(c['nodes'] as Json[])[0], event: 'no-such-event' };
      }),
      'refs',
    );
    expect(found).toEqual([
      expect.stringMatching(/\/startingBike: no bike "hoverboard"/),
      expect.stringMatching(/\/nodes\/0\/event: no event "no-such-event"/),
    ]);
  });
});

// Playtest 3 (round 1: "each tier unlocks the next bike class, and the boss of each tier must be
// beaten first"; round 3: "Six bikes": a new bike every second tier). A tier may name its boss, a
// grudge-match node of that tier that opens the next one; the last tier's boss is the region's.
describe('tier bosses and the bike ladder (playtest 3)', () => {
  const T1_GRUDGE = {
    id: 't1-grudge',
    event: 'keys-t1-kevin-grudge',
    tier: 't1',
    at: { road: 'm1-marina-run', s: 60 },
  };
  const withBosses = (edit?: (c: Json) => void) =>
    files((c) => {
      (c['nodes'] as Json[]).push(structuredClone(T1_GRUDGE));
      const tiers = c['tiers'] as Json[];
      Object.assign(tiers[0] as Json, { boss: 't1-grudge' });
      Object.assign(tiers[1] as Json, { boss: 'the-grudge', advance: { requiredWins: 0 } });
      edit?.(c);
    });

  it('a career whose tiers name grudge-match bosses, the last one the region boss, passes', () => {
    expect(errors(withBosses())).toEqual([]);
  });

  it("refuses a tier boss outside its tier, not a grudge match, or a last tier's boss that is not the region's", () => {
    const found = errors(
      withBosses((c) => {
        const tiers = c['tiers'] as Json[];
        (tiers[0] as Json)['boss'] = 'causeway-sprint';
        (tiers[1] as Json)['boss'] = 'ghost';
      }),
      'careers',
    );
    expect(found).toEqual([
      expect.stringMatching(/\/tiers\/0\/boss: tier t1's boss causeway-sprint is not a grudge-match event/),
      expect.stringMatching(/\/tiers\/1\/boss: no node ghost in tier t2/),
      expect.stringMatching(/\/tiers\/1\/boss: the last tier's boss ghost is not the region boss the-grudge/),
    ]);
    const elsewhere = errors(
      withBosses((c) => {
        (c['tiers'] as Json[])[0] = { ...(c['tiers'] as Json[])[0], boss: 'the-grudge' };
      }),
      'careers',
    );
    expect(elsewhere).toEqual([expect.stringMatching(/\/tiers\/0\/boss: no node the-grudge in tier t1/)]);
  });

  it("a tier's gate counts its regular nodes only: the boss is not one of the wins it asks", () => {
    const found = errors(
      withBosses((c) => {
        (c['tiers'] as Json[])[0] = { ...(c['tiers'] as Json[])[0], advance: { requiredWins: 2 } };
      }),
      'careers',
    );
    expect(found).toEqual([
      expect.stringMatching(
        /\/tiers\/0\/advance\/requiredWins: 2 wins asked, but the tier has 1 regular nodes/,
      ),
    ]);
  });

  // The base pack's own Keys career sells the Streetfighter for $6,000 today; a test career
  // selling it too is a step-up bike in two shops.
  const twoShops = (keysBosses: boolean) => {
    const out = withBosses((c) => {
      c['shop'] = [
        { bike: 'rustbucket-400', priceCash: 0, unlockTier: 't1' },
        { bike: 'streetfighter-750', priceCash: 16750, unlockTier: 't2' },
      ];
    });
    if (!keysBosses) return out;
    return out.map((f) => {
      if (f.path !== 'careers/keys-circuit.json') return f;
      const keys = structuredClone(f.json) as Json;
      // Name a boss on each tier of the real Keys career (its grudge nodes, the region boss last).
      const bosses = ['kevin-grudge', 'chad-grudge', 'junkyard-hunt', 'drawbridge'];
      (keys['tiers'] as Json[]).forEach((t, i) => (t['boss'] = bosses[i]));
      return { ...f, json: keys };
    });
  };
  const findings = (f: PackFile[], level: 'error' | 'warning') => {
    const parsed = parsePack(f);
    return (parsed.pack ? lintPacks([parsed.pack], { rules: packRules }) : [])
      .filter((x) => x.level === level && x.rule === 'careers' && /shop/.test(x.pointer))
      .map((x) => formatFinding(x));
  };

  it('a priced bike in two shops only warns while a career still has no tier bosses', () => {
    const f = twoShops(false);
    expect(findings(f, 'error')).toEqual([]);
    expect(findings(f, 'warning')).toEqual(
      expect.arrayContaining([expect.stringMatching(/streetfighter-750 is for sale in 2 shops/)]),
    );
  });

  it('and fails once every career selling it names its tier bosses; a free bike is never counted', () => {
    const f = twoShops(true);
    const keysTiers = (f.find((x) => x.path === 'careers/keys-circuit.json')?.json as Json)[
      'tiers'
    ] as Json[];
    expect(keysTiers.every((t) => typeof t['boss'] === 'string')).toBe(true);
    const found = findings(f, 'error');
    expect(found).toEqual(
      expect.arrayContaining([expect.stringMatching(/streetfighter-750 is for sale in 2 shops/)]),
    );
    expect(found.join('\n')).not.toMatch(/rustbucket-400/);
  });
});

describe('event rules by kind', () => {
  it('asks each kind for the rules it needs, and a grudge rival must be a rider', () => {
    const schema = (kind: string, rules: Json) =>
      errors(
        files((_c, boss) => Object.assign(boss, { kind, rules })),
        'schema',
      ).map((e) => e.replace(/^.*?\/rules/, '/rules'));
    expect(schema('takedown-hunt', {})).toEqual([
      expect.stringMatching(/^\/rules\/targetCount: a takedown-hunt event needs rules.targetCount/),
    ]);
    expect(schema('cop-escape', { escapeBy: 'survive' })).toEqual([
      expect.stringMatching(/^\/rules\/surviveS: /),
    ]);
    expect(schema('cop-escape', { escapeBy: 'distance', escapeDistanceM: 800 })).toEqual([]);
    expect(schema('grudge-match', { winBy: 'finish-ahead' })).toEqual([
      expect.stringMatching(/^\/rules\/rival: /),
    ]);
    expect(schema('classic-race', {})).toEqual([]);
    const refs = errors(
      files((_c, boss) => ((boss['rules'] as Json)['rival'] = 'nobody')),
      'refs',
    );
    expect(refs).toEqual([expect.stringMatching(/\/rules\/rival: no rider "nobody"/)]);
  });

  it('an objective kind outside the list fails', () => {
    const found = errors(
      files(
        (_c, boss) => ((boss['objectives'] as Json[])[0] = { id: 'x', kind: 'win-hearts', required: true }),
      ),
      'schema',
    );
    expect(found).toEqual([expect.stringMatching(/\/objectives\/0\/kind/)]);
  });
});
