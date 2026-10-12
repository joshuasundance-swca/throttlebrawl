import { keyLabel, keyMapFromBindings, type Bindings, type KeyAction } from '../input';

/** Compact keyboard advice on the first screen. */
export function startKeyHints(bindings: Bindings): string[] {
  const map = keyMapFromBindings(bindings);
  const primary = (action: KeyAction) => keyLabel(map[action][0]!);
  return [
    `${primary('throttle')} ride · ${primary('brake')} brake`,
    `${primary('steerLeft')} / ${primary('steerRight')} steer · ${primary('attack')} hit · ${primary('kick')} kick`,
    'Esc pause',
  ];
}

/** The career's touch advice with keyboard labels resolved when it is displayed. */
export function careerPromptText(text: string, bindings: Bindings): string {
  const map = keyMapFromBindings(bindings);
  // These are the career's existing keyboard suffixes, not touch words. Resolve in one pass so
  // mapping one action to another action's default key cannot cause a second substitution.
  const actions: Readonly<Record<string, KeyAction>> = {
    W: 'throttle',
    J: 'attack',
    K: 'kick',
    SPACE: 'skipRunBack',
  };
  return text.replace(/\[(W|J|K|SPACE)\]/g, (_match, key: string) => `[${keyLabel(map[actions[key]!][0]!)}]`);
}
