// The only words an atlas may hold: real landmark lettering (README.md, "No vetoable words").
//
// Invented copy (billboards, shop names, signs, cart names) stays in pack data, drawn by the game's
// canvas code, so the in-game "cut this" veto can remove it. A word baked into an atlas could not
// be cut. Every string a sheet draws with `glyphs5x7` must be a whole-word run of one phrase here
// (so "MILE" over "0" on two lines is fine). Adding a phrase is a reviewed edit to this file, with
// the landmark it is on; a sheet cannot add one (atlas sheets live in sheets/, written by Codex).
export const REAL_LETTERING = [
  // The Southernmost Point buoy, Key West (CX2's `southernmost_buoy`).
  'SOUTHERNMOST POINT',
  // The US 1 mile marker 0, Key West (CX2's `mile_marker_0`).
  'MILE 0',
];

/** True when `text` is a whole-word run of some phrase in REAL_LETTERING. */
export function isRealLettering(text) {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  return REAL_LETTERING.some((phrase) => {
    const pw = phrase.split(' ');
    for (let i = 0; i + words.length <= pw.length; i++) {
      if (words.every((w, j) => w === pw[i + j])) return true;
    }
    return false;
  });
}
