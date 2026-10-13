import type { AskDef, Onboarding, Prompt, RaceLog } from '../career';
import type { SimEvent, SimSnapshot } from '../sim/api';
import type { CareerFlow } from './career-flow';

/** The historical part of a career race; presentation consumes the returned notices. */
export interface CareerProgress {
  log: RaceLog | null;
  onboarding: Onboarding;
  doneTick: number | null;
  headline: string;
  ask: AskDef | null;
  askLog: RaceLog | null;
  askMet: boolean;
}

export interface CareerProgressNotices {
  prompt: Prompt | null;
  headline: string | null;
  ask: AskDef | null;
  thanks: AskDef | null;
}

/** Uses the pre-step tick and post-step snapshot, identically during riding and reconstruction. */
export function noteCareerProgress(
  flow: Pick<CareerFlow, 'ASK_AT_FRACTION' | 'createRaceLog' | 'askObjective'>,
  progress: CareerProgress,
  events: readonly SimEvent[],
  snapshot: SimSnapshot,
  playerId: number,
  tick: number,
): CareerProgressNotices {
  const notices: CareerProgressNotices = { prompt: null, headline: null, ask: null, thanks: null };
  if (!progress.log) return notices;
  progress.log.note(events, snapshot);
  notices.prompt = progress.onboarding.note(events, snapshot, playerId);
  const status = progress.log.status();
  if (status.headline !== progress.headline) {
    progress.headline = status.headline;
    notices.headline = status.headline;
  }
  if (status.endNow && progress.doneTick === null) progress.doneTick = tick;
  const me = snapshot.entities[playerId];
  if (!progress.ask || !me) return notices;
  if (!progress.askLog) {
    const length = snapshot.race.routeLength;
    if (snapshot.race.over || me.finished || length <= 0 || me.progress < flow.ASK_AT_FRACTION * length)
      return notices;
    progress.askLog = flow.createRaceLog({
      playerId,
      rules: { kind: 'classic-race' },
      objectives: [flow.askObjective(progress.ask)],
      routeId: '',
      roadIds: [],
    });
    notices.ask = progress.ask;
  }
  // Feed the threshold step too: the ask is judged from its creation, inclusively.
  progress.askLog.note(events, snapshot);
  if (!progress.askMet && progress.askLog.status().objectives[0]?.met === true) {
    progress.askMet = true;
    notices.thanks = progress.ask;
  }
  return notices;
}
