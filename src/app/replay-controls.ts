import type { ReplayAction } from '../ui';

/** Viewer shortcuts never consult or change the live race's bindings. */
export function replayKeyAction(code: string, repeat: boolean): ReplayAction | null {
  if (repeat) return null;
  switch (code) {
    case 'Space':
    case 'Enter':
      return 'toggle';
    case 'KeyR':
      return 'restart';
    case 'KeyC':
      return 'camera';
    case 'Escape':
      return 'return';
    default:
      return null;
  }
}

type Pad = Pick<Gamepad, 'index' | 'connected'> & {
  readonly buttons: readonly Pick<GamepadButton, 'pressed'>[];
};
/** Entry and newly connected controllers establish a neutral edge baseline first. */
export function createReplayControls(initial: readonly (Pad | null)[]) {
  const actions: readonly ReplayAction[] = ['toggle', 'return', 'restart', 'camera'];
  let previous = new Map<number, Set<number>>();
  const read = (pads: readonly (Pad | null)[]) =>
    new Map(
      pads
        .filter((p): p is Pad => p !== null && p.connected)
        .map((p) => [p.index, new Set(p.buttons.flatMap((b, i) => (b.pressed ? [i] : [])))]),
    );
  previous = read(initial);
  return {
    poll(pads: readonly (Pad | null)[]): ReplayAction[] {
      const next = read(pads);
      const pressed = new Set<ReplayAction>();
      for (const [index, buttons] of next) {
        const before = previous.get(index);
        if (!before) continue;
        for (const button of buttons) {
          const action = actions[button];
          if (action && !before.has(button)) pressed.add(action);
        }
      }
      previous = next;
      return [...pressed];
    },
  };
}
