import { describe, expect, it } from 'vitest';
import type { CareerView, NodeCard, TierView } from '../career';
import {
  bikeNotes,
  findAll,
  ledgerNode,
  mapLegendNode,
  money,
  nodeTag,
  racesToAfford,
  regionLockNode,
  regionTabLabel,
  seasonBadge,
  seasonCardNode,
  shutRegionView,
  SHOW_CSS,
  tallyLine,
  textOf,
  tierHead,
} from './career-show';

// Playtest 3, the career screens: the maintainer's tiers, bosses, region order, garage and seasons
// as the screens say them. Each piece is a function of the view (a node tree or a string), so the
// words are read here without a browser; tests/e2e/career.spec.ts and career-layout.spec.ts check
// the same pieces on the real page in CI.

const card = (over: Partial<NodeCard> = {}): NodeCard => ({
  id: 'n',
  name: 'An Event',
  kindLabel: 'Classic race',
  objective: 'Finish the race.',
  bonuses: [],
  route: '',
  km: 3,
  timeOfDay: 'Noon',
  prize: 900,
  state: 'open',
  reason: '',
  boss: false,
  tierBoss: false,
  best: null,
  where: '',
  rivals: [],
  ...over,
});
const tier = (over: Partial<TierView> = {}): TierView => ({
  name: 'Tourist Season',
  open: true,
  wins: 0,
  requiredWins: 2,
  nodes: [
    card({ id: 'a' }),
    card({ id: 'b' }),
    card({ id: 'boss', tierBoss: true, kindLabel: 'Grudge match' }),
  ],
  ...over,
});
const regionRow = (id: string, name: string, over: Record<string, unknown> = {}) => ({
  id,
  name,
  careerName: `${name} Circuit`,
  won: 0,
  nodes: 16,
  finaleBeaten: false,
  open: true,
  lockReason: '',
  ...over,
});
const view = (over: Partial<CareerView> = {}): CareerView => ({
  season: { n: 1, label: 'Season 1' },
  seasonCard: null,
  cash: 500,
  bike: { key: 'base:rustbucket-400', name: 'Rustbucket 400', paint: null },
  regions: [
    regionRow('florida-keys', 'The Keys'),
    regionRow('pacific-northwest', 'The Pacific Northwest', {
      open: false,
      lockReason: 'Opens when Mother Rust falls.',
    }),
  ],
  region: {
    id: 'pacific-northwest',
    name: 'The Pacific Northwest',
    careerName: 'The Fir County Circuit',
    tierName: 'Light Drizzle',
    tally: { won: 0, nodes: 16, claimed: 0, secretsFound: 0, secrets: 3, shortcutsFound: 0, shortcuts: 0 },
    finaleBeaten: false,
  },
  tiers: [
    tier(),
    tier({
      name: 'Downpour',
      open: false,
      nodes: [card({ id: 'c', state: 'locked', reason: 'Beat Kevin first.' })],
    }),
  ],
  suggested: 'a',
  map: [
    {
      id: 'net',
      name: 'Net',
      roads: [],
      secrets: [],
      bounds: [0, 0, 1, 1],
      pins: [
        { id: 'a', x: 0, z: 0, state: 'open', boss: false, tierBoss: false, suggested: true },
        { id: 'boss', x: 1, z: 1, state: 'open', boss: false, tierBoss: true, suggested: false },
      ],
    },
  ],
  ...over,
});

describe('money, signed', () => {
  it('a negative amount puts the minus before the dollar sign (live check: "$-150")', () => {
    expect(money(-150)).toBe('-$150');
    expect(money(150)).toBe('$150');
    expect(money(-1234.4)).toBe('-$1,234');
    // A rounding to zero is not a loss.
    expect(money(-0.2)).toBe('$0');
    expect(money(0)).toBe('$0');
  });

  it('the results ledger writes repairs and the fine the same way, and never "$-"', () => {
    const tree = ledgerNode(
      [
        { label: '1st place', cash: 1350 },
        { label: 'Repairs ×3', cash: -150 },
      ],
      396,
      804,
    );
    expect(findAll(tree, 'ledger-line').map((r) => textOf(r))).toEqual([
      '1st place $1,350',
      'Repairs ×3 -$150',
      'Fine -$396',
      'Cash $804',
    ]);
    expect(textOf(tree)).not.toContain('$-');
    expect(findAll(tree, 'total')).toHaveLength(1);
    expect(tree.id).toBe('career-results-cash');
  });

  it('a clean race has no fine line', () => {
    expect(textOf(ledgerNode([{ label: '2nd place', cash: 600 }], 0, 1100))).not.toContain('Fine');
  });
});

describe('the map: chapters, tiers and bosses', () => {
  it('a tier boss and a region boss are tagged in words, not only by shape', () => {
    expect(nodeTag(card({ tierBoss: true }))).toBe('TIER BOSS');
    expect(nodeTag(card({ boss: true }))).toBe('REGION BOSS');
    expect(nodeTag(card())).toBe('');
  });

  it('a tier header says what is left: wins first, then the boss, then beaten', () => {
    expect(tierHead(tier({ wins: 1 })).status).toBe('1/2 wins, then the boss');
    expect(tierHead(tier({ wins: 2 })).status).toBe('boss open');
    const beaten = tier({ wins: 2, nodes: [card({ id: 'boss', tierBoss: true, state: 'won' })] });
    expect(tierHead(beaten).status).toBe('boss beaten');
    // A wins counter never reads past its target.
    expect(tierHead(tier({ wins: 5 })).status).toBe('boss open');
  });

  it('a tier with no boss reads wins only; a locked tier says why, from its first locked card', () => {
    expect(tierHead(tier({ wins: 1, nodes: [card({ id: 'a' })] })).status).toBe('1/2 wins');
    const locked = tierHead(
      tier({
        open: false,
        nodes: [card({ state: 'locked', reason: 'Beat Kevin from Accounting in Tourist Season.' })],
      }),
    );
    expect(locked.status).toBe('locked');
    expect(locked.why).toBe('Beat Kevin from Accounting in Tourist Season.');
    expect(tierHead(tier()).why).toBe('');
  });

  it('the line under the career name names the high-water tier and the tally', () => {
    const v = view({
      region: {
        id: 'florida-keys',
        name: 'The Keys',
        careerName: 'The Keys Circuit',
        tierName: 'Hurricane Season',
        tally: {
          won: 5,
          nodes: 16,
          claimed: 2,
          secretsFound: 1,
          secrets: 3,
          shortcutsFound: 0,
          shortcuts: 0,
        },
        finaleBeaten: false,
      },
      tiers: [
        tier(),
        tier({ name: 'Hurricane Season' }),
        tier({ name: 'Off Season', open: false }),
        tier({ open: false }),
      ],
    });
    expect(tallyLine(v)).toBe('Tier 2 of 4: Hurricane Season · won 5/16 · roads claimed 2 · secrets 1/3');
    expect(tallyLine({ ...v, region: { ...v.region, finaleBeaten: true } })).toContain('Free play');
  });

  it('the season badge names the season and, from Season 2, its name', () => {
    expect(seasonBadge(view())).toBe('Season 1');
    expect(seasonBadge(view({ season: { n: 2, label: 'Season 2: Renewed' } }))).toBe('Season 2: Renewed');
  });

  it('the legend names each pin shape, so a boss reads without a colour', () => {
    const text = textOf(mapLegendNode());
    for (const word of ['event', 'tier boss', 'region boss']) expect(text).toContain(word);
  });
});

describe('regions in order, as shown', () => {
  it('a shut region says why and where its boss is, on the banner and the tab', () => {
    const v = view();
    const lock = regionLockNode(v);
    expect(lock).not.toBeNull();
    const text = textOf(lock as never);
    expect(text).toContain('Opens when Mother Rust falls.');
    expect(text).toContain('The Keys');
    expect(regionTabLabel(v.regions[1] as never)).toBe('The Pacific Northwest 0/16 · locked');
    expect(regionTabLabel(v.regions[0] as never)).toBe('The Keys 0/16');
    const done = { ...(v.regions[0] as object), finaleBeaten: true, won: 16 };
    expect(regionTabLabel(done as never)).toBe('The Keys 16/16 ★');
  });

  it('an open region draws no lock', () => {
    expect(regionLockNode(view({ region: { ...view().region, id: 'florida-keys' } }))).toBeNull();
  });

  it('a shut region shows every event locked with the region reason, whatever its own tiers say', () => {
    const v = shutRegionView(view());
    const cards = v.tiers.flatMap((t) => t.nodes);
    expect(cards.length).toBeGreaterThan(0);
    for (const c of cards) {
      expect(c.state, c.id).toBe('locked');
      expect(c.reason, c.id).toBe('Opens when Mother Rust falls.');
    }
    expect(v.tiers.every((t) => !t.open)).toBe(true);
    expect(v.map.flatMap((m) => m.pins).every((p) => p.state === 'locked' && !p.suggested)).toBe(true);
    expect(v.suggested).toBeNull();
  });

  it('an open region comes back as it is', () => {
    const v = view({ region: { ...view().region, id: 'florida-keys' } });
    expect(shutRegionView(v)).toBe(v);
  });
});

describe('seasons, as the card says them', () => {
  const season = { season: 2, title: 'Season 2: Renewed', lines: ['SEASON 2. A.', 'B.', 'C.'] };

  it('the Season card: its title, its lines, and what starting does to the maps', () => {
    const tree = seasonCardNode(season);
    expect(tree).toMatchObject({ id: 'career-season-card', cls: 'career-season-card' });
    expect(findAll(tree, 'season-title')[0]?.text).toBe('Season 2: Renewed');
    const text = textOf(tree);
    expect(text).toContain('SEASON 2. A.');
    expect(text).toMatch(/maps start over/i);
    expect(text).toMatch(/cash, bikes/i);
  });

  it('the season title wraps and sits level, so a small phone keeps its first line', () => {
    // Wave A check, unmeasured: the shared rotated title may clip its first line in a narrow card.
    // The card's own title wraps anywhere, is not rotated and keeps a roomy line; the browser
    // layout check (tests/e2e/career-layout.spec.ts) measures it on small phones.
    const rule = /\.career-season-card \.season-title \{([^}]*)\}/.exec(SHOW_CSS)?.[1] ?? '';
    expect(rule).toContain('transform: none');
    expect(rule).toContain('overflow-wrap: anywhere');
    expect(rule).not.toContain('nowrap');
    expect(rule).toMatch(/line-height: 1\.[2-9]/);
  });
});

describe('the garage: the bikes and how long each takes to afford', () => {
  const row = (over: Record<string, unknown> = {}) =>
    ({
      key: 'base:sport-600',
      name: 'Sport 600',
      speed: '112 mph',
      priceCash: 9750,
      state: 'for-sale',
      current: false,
      secret: false,
      reason: '',
      ...over,
    }) as never;
  const notes = (r: never, cash: number, pay?: number) => bikeNotes(r, cash, pay).join(' · ');

  it('races to afford is the gap over what a race pays, rounded up; none once the cash is there', () => {
    expect(racesToAfford(9750, 500, 1350)).toBe(7);
    expect(racesToAfford(9750, 9750, 1350)).toBe(0);
    expect(racesToAfford(9750, 20000, 1350)).toBe(0);
    expect(racesToAfford(2000, 500, 1000)).toBe(2);
    // No known pay: no promise.
    expect(racesToAfford(9750, 500, 0)).toBeNull();
    expect(racesToAfford(9750, 500, undefined)).toBeNull();
  });

  it('a bike for sale says its price in races of pay; one you can buy says so', () => {
    expect(notes(row(), 500, 1350)).toContain('about 7 races to afford');
    expect(notes(row(), 500, 1350)).toContain('$9,750');
    expect(notes(row(), 12000, 1350)).toContain('you can afford it');
    expect(notes(row(), 9500, 1350)).toContain('about 1 race to afford');
  });

  it('a locked bike gives its speed and lock reason first, then its price in races', () => {
    const locked = row({
      state: 'locked',
      reason: 'Opens when you beat Kevin from Accounting in Tourist Season (The Keys).',
    });
    expect(bikeNotes(locked, 500, 1350)[0]).toContain('112 mph');
    expect(notes(locked, 500, 1350)).toContain('Opens when you beat Kevin from Accounting');
    expect(notes(locked, 500, 1350)).toContain('about 7 races');
  });

  it('the bike you ride says what a crash costs; an owned one adds no price line', () => {
    const riding = notes(row({ state: 'owned', current: true, priceCash: 0, repairCash: 168 }), 500, 1350);
    expect(riding).toContain('riding it');
    expect(riding).toContain('a crash costs about $168 to fix');
    expect(riding).not.toContain('afford');
    expect(notes(row({ state: 'owned' }), 500, 1350)).not.toContain('afford');
  });

  it('a step-up bike is numbered of the ladder; a novelty ride is called one', () => {
    expect(bikeNotes(row({ step: 2, steps: 6 }), 500, 1350)[0]).toContain('Step 2 of 6');
    expect(bikeNotes(row(), 500, 1350)[0]).toContain('Novelty ride');
  });
});
