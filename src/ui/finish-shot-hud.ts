// The race screen over the finish shot (playtest 4, run C's fix check: "the touch buttons, the heat badge and
// the position stay on screen over Coit Tower"). While the camera frames a landmark after the player's finish
// (camera/finish-shot.ts), the race HUD (the speed, the position, the health bars, the heat badge, the objective,
// the ticker, the pause button) and the touch buttons are hidden, so the picture is the shot alone; the results
// screen follows two seconds later, and the next race's screen shows them again. The root carries the flag as
// `data-finish-shot="on"`; the rule hides without moving anything (`visibility`), so no layout shifts under it.
// [default]

/** Everything on the race screen that is hidden for the shot: the HUD, the touch surface and the slow-frames offer. */
export const FINISH_SHOT_HIDDEN: readonly string[] = ['#hud', '#touch-surface', '#look-offer'];

/** The root's data attribute that says the shot is on. */
export const FINISH_SHOT_ATTR = 'finishShot';

export const FINISH_SHOT_CSS = `
${FINISH_SHOT_HIDDEN.map((id) => `#ui[data-finish-shot='on'] ${id}`).join(',\n')} { visibility: hidden !important; pointer-events: none !important; }
`;

/** Whether the HUD is hidden: in the race, from the first frame of the shot until the results (or the next race) take over. */
export function finishShotHudOn(state: string, shot: object | null): boolean {
  return state === 'race' && shot !== null;
}

/** Sets or clears the shot's flag on the UI root; the same value twice changes nothing. */
export function setFinishShotFlag(root: { dataset: Record<string, string | undefined> }, on: boolean): void {
  if (on) {
    if (root.dataset[FINISH_SHOT_ATTR] !== 'on') root.dataset[FINISH_SHOT_ATTR] = 'on';
  } else if (FINISH_SHOT_ATTR in root.dataset) delete root.dataset[FINISH_SHOT_ATTR];
}
