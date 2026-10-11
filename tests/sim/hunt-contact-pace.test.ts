// docs/milestones/hunt-contact-pace.md: a fast, forward-riding player needs a real
// combat window after accelerating, rather than only the slow opening-grid encounter.
import { describe, expect, it } from 'vitest';
import { buildSimConfig, streamForEvent } from '../../src/app/config';
import { careerRaceSetup } from '../../src/app/career-flow';
import { quickPlaySetup } from '../../src/app/quick-play-events';
import { careerDefs, startCareer } from '../../src/career';
import { registryFromGlob } from '../../src/content';
import { DEFAULT_PROFILE, DEFAULT_RACE_OPTIONS } from '../../src/save';
import { createSim, quantizeInput, SIM_HZ, type SimConfig, type SimInput } from '../../src/sim/api';
import { maxYawAt } from '../../src/sim/riders';
import { firstSeed, ISOLATED, seedRange } from './batch';

const REG = registryFromGlob(import.meta.glob('/packs/*/**/*.json', { eager: true, import: 'default' }));
const DEFS = careerDefs(REG);
const DEF = DEFS.find((d) => d.nodes.some((n) => REG.events[n.event]?.kind === 'takedown-hunt'))!;
const NODE = DEF.nodes
  .filter((n) => REG.events[n.event]?.kind === 'takedown-hunt')
  .sort((a, b) => a.tier - b.tier || a.id.localeCompare(b.id))[0]!;
const EVENT = NODE.event;
const BIKE = 'base:superbike-1000';
const TICKS = SIM_HZ * 10;
const SEEDS = seedRange(1, 8);
const TUNING = { ...ISOLATED, 'ai.aggressionScale': 0 };
type Mode = 'authored' | 'career' | 'quick-play';

function configFor(mode: Mode, seed: number, control: boolean): SimConfig {
  const profile = startCareer(DEFS, { ...DEFAULT_PROFILE });
  const career =
    mode === 'career'
      ? careerRaceSetup(
          REG,
          DEFS,
          {
            ...profile,
            bikes: { ...profile.bikes, current: BIKE, owned: [...profile.bikes.owned, BIKE] },
          },
          DEF,
          NODE,
        )
      : null;
  const picks =
    mode === 'quick-play'
      ? quickPlaySetup(
          REG,
          EVENT,
          { ...DEFAULT_RACE_OPTIONS, kind: 'hunt', bike: BIKE, cops: false },
          { owned: [BIKE], current: BIKE },
          'open',
          seed,
          'normal',
          TUNING,
        )
      : {};
  const built = buildSimConfig(REG, streamForEvent(REG, EVENT, career?.length.id), {
    seed,
    eventId: EVENT,
    playerBike: BIKE,
    cops: false,
    tuning: TUNING,
    ...(career
      ? {
          fieldLevel: career.fieldLevel ?? undefined,
          length: career.length.id,
          eventPatch: career.patch ?? undefined,
        }
      : {}),
    ...picks,
    ...(control ? { eventPatch: { ...career?.patch, kind: 'classic-race' } } : {}),
  });
  // Only construction suppresses the new floor. Both physical runs are Hunts, including any
  // future Hunt-specific sim behavior; the old policy differs solely in starting pace/caps.
  return control ? { ...built, event: { ...built.event, kind: 'takedown-hunt' } } : built;
}

interface Window {
  target: string;
  start: number;
  end: number;
  gapM: number;
  lateralM: number;
  heightM: number;
  playerMps: number;
  relativeMps: number;
  maxGapM: number;
  maxLateralM: number;
  maxHeightM: number;
  minPlayerMps: number;
  maxPlayerMps: number;
  minRelativeMps: number;
  maxRelativeMps: number;
}

/** Both full-field policies replay the same pre-recorded ordinary rider commands. */
function ride(config: SimConfig, recorded?: readonly SimInput[]) {
  const sim = createSim(config);
  const playerId = config.riders.findIndex((r) => r.controller.kind === 'player');
  const punch = config.weapons.find((w) => w.contentId === 'base:punch')!;
  const needed = punch.windupTicks + punch.activeTicks;
  // Beyond the original field's fastest bike cap, this encounter cannot be the idle grid pass.
  const oldCap = Math.max(
    0,
    ...config.riders
      .filter((r) => r.controller.kind === 'ai')
      .map((r) => REG.bikes[r.bike.contentId]!.handling.topSpeedMps),
  );
  const reachHeight = config.tuning['combat.reachHeightM']!;
  const input: SimInput[] = [];
  let snapshot = sim.snapshot();
  const start = snapshot.entities[playerId]!;
  const opening = start.road.edge;
  // Stop before the road's first optional branch. Navigation after a split is a different probe.
  const split = config.road
    .splitZones()
    .filter((z) => z.edge === opening)
    .map((z) => z.s0);
  const stopS = Math.min(config.road.edges[opening]!.length, ...split);
  const grid = snapshot.entities
    .filter((e) => e.kind === 'rider')
    .map((r) => ({ id: r.contentId, progress: r.progress, d: r.road.d }));
  const lengths = new Map<number, number>();
  const windows = new Map<number, Window>();
  let longest = 0;
  let window: Window | null = null;
  let initialContact = 0;
  let highSpeedTicks = 0;
  let offRoadTicks = 0;
  let backwardsTicks = 0;
  let outsideLaneTicks = 0;
  let maxStepM = 0;
  while (sim.tick < TICKS && !sim.isOver()) {
    const me = snapshot.entities[playerId]!;
    if (me.road.edge !== opening || me.road.s >= stopS) break;
    if (recorded && !recorded[sim.tick]) break;
    const lane = config.road
      .lanesAt(me.road.edge, me.road.s)
      .find((l) => l.kind === 'drive' && l.direction === me.road.dir)!;
    const want =
      (lane.dCenterM - me.road.d) * 0.05 * me.road.dir +
      (config.road.kappaAt(me.road.edge, me.road.s) * me.speed) / 4;
    const steer = (want - me.road.yaw) / maxYawAt(config.riders[playerId]!.bike.steerRateMps, me.speed, 1);
    const command = recorded?.[sim.tick] ?? quantizeInput({ steer, throttle: 1, brake: 0, flags: 0 });
    input.push(command);
    sim.step([command]);
    snapshot = sim.snapshot();
    const p = snapshot.entities[playerId]!;
    const advanced = p.progress - me.progress;
    maxStepM = Math.max(maxStepM, advanced);
    if (advanced < -0.01 || p.road.dir !== start.road.dir) backwardsTicks++;
    if (p.mode !== 'Road') offRoadTicks++;
    const legal = config.road
      .lanesAt(p.road.edge, p.road.s)
      .some(
        (l) =>
          l.kind === 'drive' && l.direction === p.road.dir && Math.abs(p.road.d - l.dCenterM) <= l.widthM / 2,
      );
    if (!legal) outsideLaneTicks++;
    if (p.speed > oldCap) highSpeedTicks++;
    for (const r of snapshot.entities.filter(
      (e) => e.kind === 'rider' && e.slot < 0 && e.faction !== 'law',
    )) {
      const gapM = r.progress - p.progress;
      const lateralM = r.road.d - p.road.d;
      const heightM = r.road.h - p.road.h;
      const contact =
        p.mode === 'Road' &&
        r.mode === 'Road' &&
        r.health > 0 &&
        !r.finished &&
        r.road.edge === p.road.edge &&
        Math.abs(gapM) <= punch.reachSM &&
        Math.abs(lateralM) <= punch.reachDM &&
        Math.abs(heightM) <= reachHeight;
      if (contact) initialContact++;
      const n = contact && p.speed > oldCap ? (lengths.get(r.id) ?? 0) + 1 : 0;
      lengths.set(r.id, n);
      if (n === 0) {
        windows.delete(r.id);
        continue;
      }
      const previous = windows.get(r.id);
      const relativeMps = r.speed - p.speed;
      const current: Window = {
        target: r.contentId,
        start: sim.tick - n + 1,
        end: sim.tick,
        gapM,
        lateralM,
        heightM,
        playerMps: p.speed,
        relativeMps,
        maxGapM: Math.max(Math.abs(gapM), previous?.maxGapM ?? 0),
        maxLateralM: Math.max(Math.abs(lateralM), previous?.maxLateralM ?? 0),
        maxHeightM: Math.max(Math.abs(heightM), previous?.maxHeightM ?? 0),
        minPlayerMps: Math.min(p.speed, previous?.minPlayerMps ?? Infinity),
        maxPlayerMps: Math.max(p.speed, previous?.maxPlayerMps ?? 0),
        minRelativeMps: Math.min(relativeMps, previous?.minRelativeMps ?? Infinity),
        maxRelativeMps: Math.max(relativeMps, previous?.maxRelativeMps ?? -Infinity),
      };
      windows.set(r.id, current);
      if (n > longest) {
        longest = n;
        window = current;
      }
    }
  }
  return {
    input,
    grid,
    seed: config.seed,
    paceMps: config.event.paceMps,
    longest,
    needed,
    oldCap,
    window,
    initialContact,
    highSpeedTicks,
    offRoadTicks,
    backwardsTicks,
    outsideLaneTicks,
    maxStepM,
    ticks: sim.tick,
    caps: config.riders
      .filter((r) => r.controller.kind === 'ai')
      .map((r) => ({ id: r.contentId, capMps: r.bike.topSpeedMps })),
  };
}

describe('Hunt contact after acceleration on the real opening grid', () => {
  it.each<Mode>(['authored', 'career', 'quick-play'])(
    '%s offers a full punch window at speed with the old ride inputs',
    (mode) => {
      // The seed varies personality jitter and the generic Quick Play cast. Find a living contact
      // opportunity, then check its duration and the old-policy negative control on identical inputs.
      const search = firstSeed(
        `${mode} Hunt contact opportunity`,
        SEEDS,
        (seed) => {
          const control = configFor(mode, seed, true);
          const hunt = configFor(mode, seed, false);
          const data = ({ road: _road, route: _route, ...plain }: SimConfig) => plain;
          expect({
            ...data(hunt),
            event: { ...hunt.event, paceMps: control.event.paceMps },
            riders: hunt.riders.map((r, i) =>
              r.controller.kind === 'ai'
                ? { ...r, bike: { ...r.bike, topSpeedMps: control.riders[i]!.bike.topSpeedMps } }
                : r,
            ),
          }).toEqual(data(control));
          expect(hunt.route.start).toEqual(control.route.start);
          expect(hunt.route.mainEdges).toEqual(control.route.mainEdges);
          const before = ride(control);
          const after = ride(hunt, before.input);
          return { before, after };
        },
        ({ before, after }) =>
          before.longest < before.needed &&
          before.highSpeedTicks >= before.needed &&
          before.offRoadTicks === 0 &&
          before.backwardsTicks === 0 &&
          before.outsideLaneTicks === 0 &&
          after.longest >= after.needed &&
          after.offRoadTicks === 0 &&
          after.backwardsTicks === 0 &&
          after.outsideLaneTicks === 0,
      );
      if (!search.result || search.seed === null) throw new Error(search.summary);
      const { before, after } = search.result;
      const config = configFor(mode, search.seed, false);
      const summary = ({ input: _input, ...r }: typeof before) => r;
      process.stdout.write(
        `[hunt-contact] ${mode} ${JSON.stringify({ before: summary(before), after: summary(after) })}\n`,
      );
      expect(after.grid).toEqual(before.grid);
      expect(after.input).toEqual(before.input.slice(0, after.input.length));
      for (const i of after.input) expect(i).toMatchObject({ throttle: 255, brake: 0, flags: 0 });
      expect(
        before.initialContact,
        'negative control must detect the already-present early encounter',
      ).toBeGreaterThan(0);
      expect(before.longest, 'the old field must expose the lost contact after acceleration').toBeLessThan(
        before.needed,
      );
      expect(after.offRoadTicks).toBe(0);
      expect(after.backwardsTicks).toBe(0);
      expect(after.outsideLaneTicks).toBe(0);
      // A single-tick jump beyond two ticks of even the fastest configured bike is not physical riding.
      const fastest = Math.max(...config.riders.map((r) => r.bike.topSpeedMps));
      expect(after.maxStepM).toBeLessThan((fastest * 2) / SIM_HZ);
      expect(after.longest).toBeGreaterThanOrEqual(after.needed);
      expect(config.event.paceMps).toBe(after.paceMps);
    },
  );
});
