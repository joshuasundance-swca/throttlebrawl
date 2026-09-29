// The game state machine: boot, tap to start, menu, race, results, back to the menu. app-2 adds
// pause and restart, and "Busted" arrives with cops-1 as a kind of result.

export type AppState = 'boot' | 'tapToStart' | 'menu' | 'race' | 'results';
export type AppEvent = 'booted' | 'tapped' | 'race' | 'finished' | 'back';

const TRANSITIONS: Readonly<Record<AppState, Partial<Record<AppEvent, AppState>>>> = {
  boot: { booted: 'tapToStart' },
  tapToStart: { tapped: 'menu' },
  menu: { race: 'race' },
  race: { finished: 'results', back: 'menu' },
  results: { back: 'menu', race: 'race' },
};

/** The next state, or null when the event is not legal in this state. */
export function transition(state: AppState, event: AppEvent): AppState | null {
  return TRANSITIONS[state][event] ?? null;
}
