// The roadside smashables' closed vocabulary (run W-T, the pitch deck's #4 part 2, "the road fights
// back"; interview, 2026-10-02: "some fences smash"). Shared by content/ (the region file's
// `smashables` list), the sim (each kind's size and how it breaks) and render (each kind's shape),
// so the list is written once. A contract: a new kind is a small contract PR.

/**
 * What a smashable prop is [default]:
 * - `lobster-traps`: a stack of wire lobster traps on a pallet (the Keys);
 * - `mailbox`: a mailbox on a post, placed in a row of a few (the Keys, the Pacific Northwest);
 * - `parking-meter`: a parking meter on its pole, a few along the kerb (San Francisco);
 * - `pop-up-desk`: a startup's pop-up desk with a banner, parked on the pavement (San Francisco);
 * - `cafe-table`: a pavement cafe table and its two chairs (San Francisco);
 * - `firewood-stand`: an honour-system firewood stand, bundles and a cash box (the Pacific Northwest).
 */
export const SMASHABLE_KINDS = [
  'lobster-traps',
  'mailbox',
  'parking-meter',
  'pop-up-desk',
  'cafe-table',
  'firewood-stand',
] as const;
export type SmashableKind = (typeof SMASHABLE_KINDS)[number];
