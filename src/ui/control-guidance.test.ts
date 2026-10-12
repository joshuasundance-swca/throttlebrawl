import { describe, expect, it } from 'vitest';
import { PROMPTS } from '../career';
import { keyLabel, keyMapFromBindings, type Bindings } from '../input';
import { careerPromptText, startKeyHints } from './control-guidance';

describe('keyboard advice follows the effective controls', () => {
  const bindings: Bindings = {
    throttle: ['KeyE'],
    brake: ['KeyR'],
    steerLeft: ['KeyZ'],
    steerRight: ['KeyX'],
    attack: ['KeyF', 'Digit2'],
    kick: ['KeyV'],
    skipRunBack: ['Enter'],
    pause: ['KeyP'],
  };

  it('names active keys on the start card, including the permanent pause key', () => {
    const lines = startKeyHints(bindings).join(' ');
    expect(lines).toContain('E ride');
    expect(lines).toContain('R brake');
    expect(lines).toContain('Z / X steer');
    expect(lines).toContain('F hit');
    expect(lines).toContain('V kick');
    expect(lines).toContain('Esc pause');
    expect(lines).not.toContain('J hit');
  });

  it('resolves first-minute ride, fight and run-back advice at delivery', () => {
    expect(careerPromptText(PROMPTS['ride']!, bindings)).toContain('[E]');
    expect(careerPromptText(PROMPTS['fight']!, bindings)).toContain('[F] [V]');
    expect(careerPromptText(PROMPTS['down']!, bindings)).toContain('[Enter]');
    expect(careerPromptText(PROMPTS['fight']!, {})).toContain('[J] [K]');
    expect(careerPromptText(PROMPTS['fight']!, { attack: ['KeyG'] })).toContain('[G] [K]');
  });

  it('uses the same fallback as input for unusable overrides, with compact primary labels', () => {
    const bad = { throttle: ['Escape'], attack: [], kick: ['Backquote'], skipRunBack: [] };
    const map = keyMapFromBindings(bad);
    for (const [id, action] of [
      ['ride', 'throttle'],
      ['down', 'skipRunBack'],
    ] as const)
      expect(careerPromptText(PROMPTS[id]!, bad)).toContain(`[${keyLabel(map[action][0]!)}]`);
    expect(careerPromptText(PROMPTS['fight']!, bad)).toContain('[J] [K]');
  });

  it('preserves touch words and advice without keyboard suffixes', () => {
    for (const id of ['ride', 'fight', 'down']) {
      const text = PROMPTS[id]!;
      expect(careerPromptText(text, bindings).split('[')[0]).toBe(text.split('[')[0]);
    }
    for (const id of ['steal', 'cop', 'air', 'near-miss'])
      expect(careerPromptText(PROMPTS[id]!, bindings)).toBe(PROMPTS[id]);
  });

  it("does not substitute a remapped key again when it is another action's default", () => {
    const remapped = { attack: ['KeyK'], kick: ['KeyJ'] };
    expect(careerPromptText(PROMPTS['fight']!, remapped)).toContain('[K] [J]');
  });
});
