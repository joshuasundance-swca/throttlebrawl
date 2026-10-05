import { describe, expect, it } from 'vitest';
import { careerButtonText } from './menu-first';

// Playtest 4, P4-5 (the maintainer: "Menu first"): a new player lands on the menu and the obvious
// first tap says what it does. Where the first tap goes (never straight into a race) is held by the
// browser spec tests/e2e/ui-menu-first.spec.ts, which plays it the way a phone does.

describe('the menu career button', () => {
  it('tells a new player to start the career, and is the plain word after that', () => {
    expect(careerButtonText(false)).toBe('Start career');
    expect(careerButtonText(true)).toBe('Career');
  });
});
