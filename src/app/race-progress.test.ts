import { describe, expect, it } from 'vitest';
import { createOnboarding, createRaceLog, ASK_AT_FRACTION, askObjective } from '../career';
import type { SimEvent } from '../sim/api';
import { createHeadlessRace } from './headless';
import { noteCareerProgress, type CareerProgress } from './race-progress';

const flow = { createRaceLog, ASK_AT_FRACTION, askObjective } as const;
const race = createHeadlessRace({ seed: 77 });
const playerId = race.playerId;
function progress(): CareerProgress {
  return {
    log: createRaceLog({
      playerId,
      rules: { kind: 'takedown-hunt', targetCount: 1, endOnCount: true },
      objectives: [{ id: 'hunt', kind: 'takedowns', params: { count: 1 }, required: true, rewardCash: 0 }],
      routeId: '',
      roadIds: [],
    }),
    onboarding: createOnboarding([]),
    doneTick: null,
    headline: '',
    ask: { id: 'style', kind: 'style-cash', n: 50, cash: 100, text: 'Earn style cash.' },
    askLog: null,
    askMet: false,
  };
}
const style: SimEvent = { type: 'style', tick: 7, actor: playerId, data: { kind: 'nearMiss', points: 50 } };

describe('ordinary and historical career progress', () => {
  it('creates and fulfills an ask on its threshold tick, once', () => {
    const p = progress();
    const snap = structuredClone(race.sim.snapshot());
    snap.entities[playerId]!.progress = snap.race.routeLength * ASK_AT_FRACTION;
    const notices = noteCareerProgress(flow, p, [style], snap, playerId, 7);
    expect(notices.ask).toEqual(p.ask);
    expect(notices.thanks).toEqual(p.ask);
    expect(p.askMet).toBe(true);
    expect(p.askLog?.tally().styleCash).toBe(50);
    expect(noteCareerProgress(flow, p, [], snap, playerId, 8)).toMatchObject({ ask: null, thanks: null });
  });

  it('does not credit pre-ask events and does not ask after the player finishes', () => {
    const p = progress();
    const snap = structuredClone(race.sim.snapshot());
    snap.entities[playerId]!.progress = snap.race.routeLength * ASK_AT_FRACTION - 1;
    noteCareerProgress(flow, p, [style], snap, playerId, 7);
    expect(p.log?.tally().styleCash).toBe(50);
    expect(p.askLog).toBeNull();
    snap.entities[playerId]!.progress++;
    noteCareerProgress(flow, p, [], snap, playerId, 8);
    expect(p.askLog?.tally().styleCash).toBe(0);
    expect(p.askMet).toBe(false);
    const finished = progress();
    snap.entities[playerId]!.finished = true;
    expect(noteCareerProgress(flow, finished, [style], snap, playerId, 9).ask).toBeNull();
    expect(finished.askLog).toBeNull();
  });

  it('keeps the first pre-step early-completion tick and folds onboarding without presentation', () => {
    const p = progress();
    const snap = structuredClone(race.sim.snapshot());
    const takedown: SimEvent = {
      type: 'takedown',
      tick: 17,
      actor: playerId,
      target: 1,
      data: { kind: 'traffic' },
    };
    const steal: SimEvent = { type: 'stealWindow', tick: 17, actor: 1, target: playerId, data: {} };
    const notices = noteCareerProgress(flow, p, [takedown, steal], snap, playerId, 17);
    expect(p.doneTick).toBe(17);
    expect(p.log?.status().state).toBe('won');
    expect(notices.headline).toBe(p.headline);
    expect(notices.prompt?.id).toBe('steal');
    expect(p.onboarding.shown()).toContain('steal');
    noteCareerProgress(flow, p, [], snap, playerId, 18);
    expect(p.doneTick).toBe(17);
  });
});
