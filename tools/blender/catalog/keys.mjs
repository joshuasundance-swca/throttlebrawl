// The Florida Keys' own models (playtest 3, Codex batch CX2). Every row has `pack: 'base'` (the base
// pack is the Keys' pack) and `region: 'florida-keys'`, so the per-region model budget counts it as
// the Keys' own. CX2 appends here, after the Sport 600's row (playtest 3, T10.1); no other batch edits
// this file.
import { VIEWS } from './views.mjs';

/** @type {import('../catalog.mjs').Prop[]} */
export const KEYS_PROPS = [
  // The Sport 600 (playtest 3, T10.1, "Six bikes"): the Keys' step-up bike, a byte copy of the
  // stickered sport bike under its own id (the rider-look rule draws `models/bikes/<bike id>`).
  // The row reuses that bike's script, so a rebuild writes the same bytes; Codex replaces the
  // script with the bike's own later, under the same name.
  {
    name: 'sport_600',
    script: 'props/sport_stickered.py',
    asset: 'models/bikes/sport-600',
    pack: 'base',
    region: 'florida-keys',
    kind: 'single',
    budget: { tris: 1500, draws: 7, materials: 7 },
    single: {
      root: 'bike',
      nodes: [
        'bike_body',
        'wheel_front',
        'wheel_rear',
        'fork',
        'seat_anchor',
        'bar_l',
        'bar_r',
        'peg_l',
        'peg_r',
        'light_head',
        'light_tail',
      ],
      size: [
        [0.5, 1.4],
        [0.8, 1.8],
        [1.7, 2.7],
      ],
    },
    views: VIEWS,
  },
];
