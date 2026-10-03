// sim/race style scoring (M2 riders-5; docs/milestones/M2.md, "riders-5 · Style, race lengths and
// difficulty"). Style cash for risky riding, read from events the earlier phases emitted this tick
// and from where each racer rides:
// - nearMiss: every `nearMiss` (traffic-3 already requires a fast, close, untouched pass); a lane
//   split (W-R: data.split, threading between two vehicles) scores `race.styleSplitScale` times;
// - airtime: a `jump` to its `land` of at least `race.styleAirtimeMinS` of world time, unless the
//   landing crashed;
// - oncoming: a stretch of at least `race.styleOncomingMinS` of world time in a drive lane whose
//   `direction` differs from the rider's own `dir`, above `race.styleOncomingSpeedShare` of its top
//   speed, scored once, by the second, when the stretch ends;
// - takedownCombo: every `takedown` its credited rider lands; the k-th inside one combo (each within
//   `race.styleComboWindowS` of world time of the last) scores perTakedownCash × comboScale × k;
//   a domino takedown (combat's data.domino, W-Q) passes its chain length on as data.domino;
// - weaponSteal: a `weaponGrab` whose source is a steal;
// - trick (playtest 2, 2026-10-02: "I love the idea of doing flips"): a `land` that holds (not a
//   crash) with a `data.trick`, worth perAirtimeCash × `race.styleTrickScale` × its weight: a flip's
//   full turns (a double backflip is 2), a wheelie landing or a whip ½. It needs no minimum airtime
//   (a flip needs the air anyway), and it adds to the landing's airtime cash.
// Each scores a `style` event (data.kind, data.points) beside `addStyle`, for racers still racing;
// the law never scores, and a source worth 0 cash emits nothing. Durations are world time, the sum
// of timeScale / 60 over the ticks, so slow motion stretches nothing and hit-stop adds nothing.
import type { EntityId, TuningParamDecl } from '../../core';
import { topSpeedOf } from '../riders';
import type { SimConfig, SimEvent, SimStyleRewards, StyleKind, StyleRunSnapshot } from '../types';
import { addStyle, emit, systemState, type Mover, type World } from '../world';

export const STYLE_TUNING: readonly TuningParamDecl[] = [
  {
    id: 'race.styleAirtimeMinS',
    group: 'race',
    label: 'Style: airtime at least',
    default: 0.5,
    min: 0.1,
    max: 2,
    step: 0.05,
    unit: 's',
    affectsSim: true,
  },
  {
    id: 'race.styleOncomingMinS',
    group: 'race',
    label: 'Style: oncoming stretch at least',
    default: 2,
    min: 0.5,
    max: 6,
    step: 0.25,
    unit: 's',
    affectsSim: true,
  },
  {
    id: 'race.styleOncomingSpeedShare',
    group: 'race',
    label: 'Style: oncoming above top speed ×',
    default: 0.5,
    min: 0,
    max: 1,
    step: 0.05,
    unit: '×',
    affectsSim: true,
  },
  {
    id: 'race.styleComboWindowS',
    group: 'race',
    label: 'Style: takedown combo window',
    default: 5,
    min: 1,
    max: 15,
    step: 0.5,
    unit: 's',
    affectsSim: true,
  },
  {
    // Lane splitting (W-R; interview, 2026-10-02: "multi-lane highways (4-6 lanes, lane
    // splitting)"): a near miss that threads between two vehicles (traffic's data.split) scores
    // this many times the near-miss cash. Each vehicle of the pair is its own near miss. [default]
    id: 'race.styleSplitScale',
    group: 'race',
    label: 'Style: lane split × near miss',
    default: 2,
    min: 1,
    max: 5,
    step: 0.25,
    unit: '×',
    affectsSim: true,
  },
  {
    // A trick's style cash per weight, as a multiple of the airtime cash (playtest 2): a backflip
    // is 2× the airtime cash, a double 4×, a wheelie landing or a whip 1×. [default]
    id: 'race.styleTrickScale',
    group: 'race',
    label: 'Style: trick cash × airtime',
    default: 2,
    min: 0,
    max: 6,
    step: 0.25,
    unit: '×',
    affectsSim: true,
  },
];

/** A trick's weight in style cash (× airtime cash × race.styleTrickScale): a flip counts its turns. */
function trickWeight(trick: string, flips: number): number {
  if (trick === 'backflip' || trick === 'frontflip') return Math.max(1, flips);
  if (trick === 'wheelie' || trick === 'whip') return 0.5;
  // The newspaper (the pitch deck's #13): only on the biggest jumps, and a crash if held too long.
  if (trick === 'newspaper') return 1.5;
  return 0;
}

interface StyleState {
  /** World seconds since the race began. */
  clockS: number;
  /** By entity id: world seconds in the air since its `jump`, or -1 when not in a scored flight. */
  airS: number[];
  /** By entity id: world seconds of the current oncoming stretch (0 when not in one). */
  oncomingS: number[];
  /** By entity id: takedowns in the current combo, and the clock at the last one (-1: none yet). */
  combo: number[];
  comboAtS: number[];
}

function styleState(world: World): StyleState {
  return systemState<StyleState>(world, 'race.style', () => ({
    clockS: 0,
    airS: [],
    oncomingS: [],
    combo: [],
    comboAtS: [],
  }));
}

const NO_STYLE: SimStyleRewards = {
  perNearMissCash: 0,
  perAirtimeCash: 0,
  perOncomingSecondCash: 0,
  perTakedownCash: 0,
  takedownComboScale: 0,
  perStealCash: 0,
};

function score(
  world: World,
  id: EntityId,
  kind: StyleKind,
  points: number,
  data: Record<string, number | string | boolean> = {},
  causeId?: number,
): void {
  const cash = Math.round(points);
  if (!(cash > 0)) return;
  emit(world, 'style', id, { kind, points: cash, ...data }, causeId === undefined ? {} : { causeId });
  addStyle(world, id, cash);
}

/**
 * Whether a rider rides back the way the race came, after a U-turn (its heading sign on the route is
 * -1). Riding back pays no near-miss or oncoming cash, so turning round is never a way to farm it
 * (interview, 2026-10-02: U-turns). [default]
 */
function ridingBack(config: SimConfig, m: Mover): boolean {
  return m.pos.dir * config.route.orientation(m.pos.edge) === -1;
}

/** Whether a rider rides in a drive lane that runs against its own travel direction. */
function inOncomingLane(config: SimConfig, m: Mover): boolean {
  const { edge, s, d, dir } = m.pos;
  for (const lane of config.road.lanesAt(edge, s)) {
    if (lane.kind !== 'drive' || Math.abs(d - lane.dCenterM) > lane.widthM / 2) continue;
    if (lane.direction !== dir) return true;
  }
  return false;
}

/**
 * A rider's style run in progress, for the snapshot (playtest 1c: the live oncoming meter): its open
 * oncoming stretch, else its scored flight in the air, else null. The cash is computed exactly as
 * the scoring does, so the last value shown is the cash awarded. Reads the style state without
 * creating it, so building a snapshot never changes the sim.
 */
export function styleRunOf(world: World, config: SimConfig, id: EntityId): StyleRunSnapshot | null {
  const st = world.systems['race.style'] as StyleState | undefined;
  if (!st) return null;
  const rewards = config.event.style ?? NO_STYLE;
  const oncoming = st.oncomingS[id] ?? 0;
  if (oncoming > 0) {
    const minS = world.params['race.styleOncomingMinS'] ?? 2;
    return {
      kind: 'oncoming',
      seconds: oncoming,
      cash: cashOf(rewards.perOncomingSecondCash * oncoming),
      qualifies: oncoming + 1e-9 >= minS,
    };
  }
  const air = st.airS[id] ?? -1;
  if (air >= 0) {
    const minS = world.params['race.styleAirtimeMinS'] ?? 0.5;
    return {
      kind: 'airtime',
      seconds: air,
      cash: cashOf(rewards.perAirtimeCash),
      qualifies: air + 1e-9 >= minS,
    };
  }
  return null;
}

/** Style cash as `score` awards it: rounded to whole cash, and 0 when that is not positive. */
function cashOf(points: number): number {
  const cash = Math.round(points);
  return cash > 0 ? cash : 0;
}

function endOncoming(world: World, st: StyleState, id: EntityId, rewards: SimStyleRewards): void {
  const seconds = st.oncomingS[id] ?? 0;
  st.oncomingS[id] = 0;
  if (seconds <= 0 || seconds + 1e-9 < (world.params['race.styleOncomingMinS'] ?? 2)) return;
  score(world, id, 'oncoming', rewards.perOncomingSecondCash * seconds, { seconds });
}

/**
 * Scores this tick's style from the events emitted so far and where each rider rides. `scoring(id)`
 * says whether a rider may score (a racer still racing). An oncoming stretch that stops qualifying
 * scores as it ends.
 */
export function scoreStyle(world: World, config: SimConfig, scoring: (id: EntityId) => boolean): void {
  const st = styleState(world);
  const rewards = config.event.style ?? NO_STYLE;
  const dtS = world.timeScale / 60;
  st.clockS += dtS;

  for (const m of world.movers) {
    if (m.kind !== 'rider') continue;
    if ((st.airS[m.id] ?? -1) >= 0) st.airS[m.id] = (st.airS[m.id] ?? 0) + dtS;
  }

  const events: readonly SimEvent[] = [...world.events];
  for (const e of events) {
    const id = e.actor;
    if (id < 0 || !scoring(id)) continue;
    switch (e.type) {
      case 'nearMiss': {
        const m = world.movers[id];
        if (m && ridingBack(config, m)) break;
        // A lane split (threading between two vehicles, W-R) pays race.styleSplitScale times.
        const split = e.data['split'] === true;
        const scale = split ? (world.params['race.styleSplitScale'] ?? 2) : 1;
        score(world, id, 'nearMiss', rewards.perNearMissCash * scale, split ? { split } : {}, e.causeId);
        break;
      }
      case 'jump':
        st.airS[id] = 0;
        break;
      case 'land': {
        const air = st.airS[id] ?? -1;
        st.airS[id] = -1;
        const minS = world.params['race.styleAirtimeMinS'] ?? 0.5;
        if (air >= 0 && e.data['quality'] !== 'crash' && air + 1e-9 >= minS) {
          score(world, id, 'airtime', rewards.perAirtimeCash, { seconds: air }, e.causeId);
        }
        const trick = e.data['trick'];
        if (typeof trick === 'string' && trick !== '' && e.data['quality'] !== 'crash') {
          const flips = Number(e.data['flips'] ?? 0);
          const scale = world.params['race.styleTrickScale'] ?? 2;
          const points = rewards.perAirtimeCash * scale * trickWeight(trick, flips);
          score(world, id, 'trick', points, { trick, flips }, e.causeId);
        }
        break;
      }
      case 'crash':
        st.airS[id] = -1;
        break;
      case 'takedown': {
        const windowS = world.params['race.styleComboWindowS'] ?? 5;
        const last = st.comboAtS[id] ?? -1;
        const k = last >= 0 && st.clockS - last <= windowS + 1e-9 ? (st.combo[id] ?? 0) + 1 : 1;
        st.combo[id] = k;
        st.comboAtS[id] = st.clockS;
        score(
          world,
          id,
          'takedownCombo',
          rewards.perTakedownCash * rewards.takedownComboScale * k,
          typeof e.data['domino'] === 'number' ? { combo: k, domino: e.data['domino'] } : { combo: k },
          e.causeId,
        );
        break;
      }
      case 'weaponGrab':
        if (e.data['source'] === 'steal')
          score(world, id, 'weaponSteal', rewards.perStealCash, {}, e.causeId);
        break;
      default:
        break;
    }
  }

  const share = world.params['race.styleOncomingSpeedShare'] ?? 0.5;
  for (const m of world.movers) {
    if (m.kind !== 'rider' || !scoring(m.id)) continue;
    const def = config.riders[m.riderIndex];
    const riding = m.mode === 'Road' || m.mode === 'Airborne';
    const fast = def !== undefined && m.speed >= share * topSpeedOf(world, config, def.bike.topSpeedMps);
    if (riding && fast && !ridingBack(config, m) && inOncomingLane(config, m))
      st.oncomingS[m.id] = (st.oncomingS[m.id] ?? 0) + dtS;
    else if ((st.oncomingS[m.id] ?? 0) > 0) endOncoming(world, st, m.id, rewards);
  }
}

/**
 * Closes the open oncoming stretch of every rider who stopped racing this tick: a finisher (over
 * the line, or classified at the race end) scores it; a rider busted or down loses it.
 */
export function closeStyle(
  world: World,
  config: SimConfig,
  status: (id: EntityId) => 'racing' | 'finished' | 'other',
): void {
  const st = styleState(world);
  const rewards = config.event.style ?? NO_STYLE;
  for (const m of world.movers) {
    const now = status(m.id);
    if ((st.oncomingS[m.id] ?? 0) <= 0 || now === 'racing') continue;
    if (now === 'finished') endOncoming(world, st, m.id, rewards);
    else st.oncomingS[m.id] = 0;
  }
}
