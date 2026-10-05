// The first run opens on the main menu, with "Start career" as the obvious first tap (playtest 4,
// P4-5; the maintainer, 2026-10-04: "Menu first"). Before a career has started the menu's career
// button reads "Start career" and is drawn as the one to press; once it has started it is the plain
// "Career" button it always was. Pure and apart from the DOM, so a unit test can pin the words.

/** The career button's words: what a new player is told to tap, then the usual word. */
export function careerButtonText(started: boolean): string {
  return started ? 'Career' : 'Start career';
}

/** The class that draws the button as the first tap (the menu's CSS styles it). */
export const START_HERE_CLASS = 'start-here';

export const MENU_FIRST_CSS = `
#ui .big.${START_HERE_CLASS} { background: #e0543a; color: #f2ead8; box-shadow: 4px 4px 0 #111;
  transform: rotate(-1deg); }
#ui .big.${START_HERE_CLASS}:active { transform: translate(2px, 2px) rotate(-1deg); box-shadow: 1px 1px 0 #111; }
`;
