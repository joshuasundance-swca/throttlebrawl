// Each weapon draws as its own shape (playtest 2, 2026-10-02: riders and props "blocky and
// uninteresting"; the maintainer's art ask in the interview, 2026-10-02): a lead pipe is an elbowed
// pipe, a bike chain is a hanging run of links, the driftwood club is a knobbly taper, the campaign
// sign is a yard sign on a stake, Kevin's briefcase is a brass-latched case, the baton and the
// taser are the law's own. Code-made, flat-coloured boxes (every look recolours them through the
// `weapon` material; no textures, no grime), a handful of boxes each, so a held weapon or a pickup
// on the road is still one small draw call.
//
// Held weapons sit in the fist at the origin and point along -z (the pipe's old pose). The sim names
// a weapon by its qualified content id (`base:lead-pipe`); pickups on the road carry it as their
// `contentId`.
import type { BoxPart } from './geometry';

export type WeaponShape = 'pipe' | 'chain' | 'club' | 'sign' | 'briefcase' | 'baton' | 'taser';

export const WEAPON_SHAPES: readonly WeaponShape[] = [
  'pipe',
  'chain',
  'club',
  'sign',
  'briefcase',
  'baton',
  'taser',
];

/** The shape for a weapon's content id (qualified or bare); an unknown weapon draws as a pipe. */
export function weaponShapeOf(contentId: string | null | undefined): WeaponShape {
  const id = (contentId ?? '').toLowerCase().replace(/^.*[:/]/, '');
  if (id.includes('chain')) return 'chain';
  if (id.includes('club')) return 'club';
  if (id.includes('sign')) return 'sign';
  if (id.includes('briefcase')) return 'briefcase';
  if (id.includes('baton')) return 'baton';
  if (id.includes('taser')) return 'taser';
  return 'pipe';
}

const STEEL = '#9aa3ab';
const STEEL_DARK = '#6e777e';
const LINK = '#b8bec4';
const WOOD = '#b79a6b';
const WOOD_PALE = '#cdb88a';
const STAKE = '#a8844f';
const CASE = '#7a4a2b';
const BRASS = '#d4af37';
const BLACK = '#25272b';
const GRIP = '#44474d';
const YELLOW = '#e8c53a';
const SPARK = '#8fdcff';

function chain(): BoxPart[] {
  const parts: BoxPart[] = [{ size: [0.06, 0.06, 0.22], at: [0, 0, 0.02], color: '#3a2f28' }];
  for (let i = 0; i < 6; i++) {
    // Links alternate flat and on edge, and the run sags a little toward its heavy end.
    const flat = i % 2 === 0;
    parts.push({
      size: flat ? [0.11, 0.04, 0.13] : [0.04, 0.11, 0.13],
      at: [0, -0.006 * i * i, -0.16 - i * 0.1],
      color: LINK,
    });
  }
  // A padlock on the end, for weight.
  parts.push({ size: [0.12, 0.16, 0.12], at: [0, -0.1, -0.78], color: STEEL_DARK });
  parts.push({ size: [0.05, 0.06, 0.05], at: [0, -0.02, -0.78], color: LINK });
  return parts;
}

export const WEAPON_PARTS: Readonly<Record<WeaponShape, readonly BoxPart[]>> = {
  // A lead pipe with a collar at each end and an elbow fitting at the far one.
  pipe: [
    { size: [0.07, 0.07, 0.9], at: [0, 0, 0], color: STEEL },
    { size: [0.1, 0.1, 0.08], at: [0, 0, 0.38], color: STEEL_DARK },
    { size: [0.1, 0.1, 0.08], at: [0, 0, -0.4], color: STEEL_DARK },
    { size: [0.07, 0.18, 0.07], at: [0, -0.09, -0.46], color: STEEL },
  ],
  chain: chain(),
  // The driftwood club: a thin handle swelling to a knotty head, bleached pale.
  club: [
    { size: [0.05, 0.05, 0.26], at: [0, 0, 0.16], color: WOOD },
    { size: [0.07, 0.07, 0.2], at: [0, 0, -0.04], color: WOOD },
    { size: [0.1, 0.1, 0.2], at: [0, 0, -0.24], color: WOOD_PALE },
    { size: [0.15, 0.13, 0.22], at: [0, 0, -0.45], color: WOOD },
    { size: [0.06, 0.06, 0.06], at: [0.09, 0.03, -0.3], color: WOOD_PALE },
    { size: [0.06, 0.06, 0.06], at: [-0.08, -0.04, -0.5], color: WOOD_PALE },
  ],
  // A campaign yard sign on its stake: the stake held low, the board across the far end.
  sign: [
    { size: [0.04, 0.04, 1.0], at: [0, 0, -0.05], color: STAKE },
    { size: [0.03, 0.4, 0.56], at: [0, 0.1, -0.62], color: '#d9503a' },
    { size: [0.034, 0.1, 0.4], at: [0, 0.12, -0.62], color: '#f4f4f0' },
    { size: [0.034, 0.04, 0.4], at: [0, 0.26, -0.62], color: '#f4f4f0' },
  ],
  // Kevin's briefcase, swung by its handle: a brown case with brass latches.
  briefcase: [
    { size: [0.04, 0.05, 0.16], at: [0, 0.02, 0], color: BLACK },
    { size: [0.13, 0.3, 0.46], at: [0, -0.02, -0.3], color: CASE },
    { size: [0.14, 0.04, 0.46], at: [0, 0.14, -0.3], color: '#5a3520' },
    { size: [0.14, 0.06, 0.06], at: [0, 0.1, -0.16], color: BRASS },
    { size: [0.14, 0.06, 0.06], at: [0, 0.1, -0.44], color: BRASS },
  ],
  // The cop's baton: black, a ribbed grip and a side handle.
  baton: [
    { size: [0.05, 0.05, 0.62], at: [0, 0, -0.1], color: BLACK },
    { size: [0.065, 0.065, 0.22], at: [0, 0, 0.2], color: GRIP },
    { size: [0.04, 0.16, 0.04], at: [0, -0.08, 0.1], color: BLACK },
    { size: [0.06, 0.06, 0.04], at: [0, 0, -0.42], color: GRIP },
  ],
  // The cop's taser: a yellow body, a grip, two prongs with a blue spark between them.
  taser: [
    { size: [0.08, 0.16, 0.24], at: [0, -0.03, 0.04], color: YELLOW },
    { size: [0.06, 0.15, 0.08], at: [0, -0.15, 0.1], color: GRIP },
    { size: [0.05, 0.06, 0.12], at: [0, 0.0, -0.14], color: BLACK },
    { size: [0.015, 0.015, 0.14], at: [0.03, 0.0, -0.27], color: STEEL },
    { size: [0.015, 0.015, 0.14], at: [-0.03, 0.0, -0.27], color: STEEL },
    { size: [0.035, 0.035, 0.035], at: [0, 0.0, -0.31], color: SPARK },
  ],
};
