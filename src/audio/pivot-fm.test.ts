// Pivot FM (run W-U, the pitch deck's #5): "When Pivot rides, Pivot FM appears and changes genre every
// eight bars; knock him down and it goes to dead air, then 'We're excited to announce our next
// chapter.'" The medley composer, the player's band changes, the station file, the rider-station
// state machine, and the mixer handing the radio over and back.
import { describe, expect, it } from 'vitest';
import type { EntitySnapshot, SimSnapshot } from '../sim/api';
import { fakeContextFactory } from './fake-context';
import { createAudio, RADIO_BARK_EVENT } from './system';
import {
  createRadioPlayer,
  riderStationsFor,
  stationsForRegion,
  stationsFromTable,
  type RadioBand,
  type RadioStation,
} from './radio';
import { composeFor, RADIO_BAND } from './radio-band';
import type { Composition, RadioNote } from './radio-compose';
import { composeMedley, cutToBars, PIVOT_BARS, PIVOT_PARTS } from './radio-compose-pivot';
import type { RadioGenre, RadioRig } from './radio-synth';
import { createRiderStation, RIDER_STATION } from './rider-station';

const FILE = import.meta.glob('/packs/region-sf/stations/sf-pivot-fm.json', {
  eager: true,
  import: 'default',
});
const pivotFm = (): RadioStation =>
  stationsFromTable({ 'region-sf:sf-pivot-fm': Object.values(FILE)[0] })[0]!;

describe('the medley composer', () => {
  it('pivots every eight bars, to a different band each time, the same way for the same seed', () => {
    for (const seed of [1, 2, 3, 99, 12345]) {
      const m = composeMedley({}, seed)!;
      expect(m.medley).toHaveLength(PIVOT_PARTS.default);
      for (const [i, p] of m.medley!.entries()) {
        expect(p.comp.bars).toBe(PIVOT_BARS);
        expect(p.comp.steps).toBe(PIVOT_BARS * p.comp.stepsPerBar);
        expect(p.comp.notes.length).toBeGreaterThan(0);
        expect(p.comp.notes.every((n) => n.step >= 0 && n.step < p.comp.steps)).toBe(true);
        if (i > 0) expect(p.genre).not.toBe(m.medley![i - 1]!.genre);
      }
      expect(composeMedley({}, seed)).toEqual(m);
    }
    // Over a few seeds it visits most of the twelve bands.
    const seen = new Set(
      [1, 2, 3, 4, 5, 6, 7, 8].flatMap((s) => composeMedley({}, s)!.medley!.map((p) => p.genre)),
    );
    expect(seen.size).toBeGreaterThanOrEqual(9);
  });

  it('takes a part count from 2 to 12', () => {
    expect(composeMedley({ parts: 4 }, 7)!.medley).toHaveLength(4);
    expect(composeMedley({ parts: 1 }, 7)!.medley).toHaveLength(PIVOT_PARTS.min);
    expect(composeMedley({ parts: 99 }, 7)!.medley).toHaveLength(PIVOT_PARTS.max);
  });

  it('cuts a long song and repeats a short one to exactly the bars asked', () => {
    const note = (step: number): RadioNote => ({ step, layer: 'bass', midi: 40, len: 1, vel: 1 });
    const song = { stepsPerBar: 4, bars: 2, steps: 8, notes: [note(0), note(5)] } as unknown as Composition;
    const long = cutToBars(song, 1);
    expect(long.notes.map((n) => n.step)).toEqual([0]);
    const short = cutToBars(song, 5);
    expect(short.steps).toBe(20);
    expect(short.notes.map((n) => n.step)).toEqual([0, 5, 8, 13, 16]);
  });
});

describe('the station file', () => {
  it("is Pivot's, never on the San Francisco dial, and every track is a medley", () => {
    const s = pivotFm();
    expect(s.rider).toBe('region-sf:pivot');
    expect(s.deadAirLine).toBe('region-sf:bark-set/pivot-core#pivot-fm-next-chapter');
    expect(stationsForRegion([s], 'region-sf:san-francisco')).toEqual([]);
    expect(riderStationsFor([s], 'region-sf:san-francisco')).toEqual([s]);
    expect(riderStationsFor([s], 'base:florida-keys')).toEqual([]);
    expect(s.tracks.length).toBeGreaterThanOrEqual(5);
    for (const t of s.tracks) {
      expect(t.status).toBe('live');
      expect(t.origin).toBe('agent');
      expect(composeFor(t)?.medley?.length).toBeGreaterThanOrEqual(PIVOT_PARTS.min);
    }
  });
});

describe('the player changes band with each part', () => {
  it('plays each part on its own rig and cuts to the next at the part boundary', () => {
    const { ctx } = fakeContextFactory();
    const played: { genre: RadioGenre; t: number }[] = [];
    const levels: { genre: RadioGenre; level: number; at: number }[] = [];
    const part = (n: number): Composition =>
      ({
        stepsPerBeat: 4,
        stepsPerBar: 4,
        bars: 1,
        steps: 4,
        stepS: 0.1,
        notes: [0, 1, 2, 3].map((step) => ({ step, layer: 'bass', midi: 40 + n, len: 1, vel: 1 })),
      }) as unknown as Composition;
    const band: RadioBand = {
      compose: () => ({
        ...part(0),
        medley: [
          { genre: 'surf', comp: part(0) },
          { genre: 'chip', comp: part(1) },
        ],
      }),
      rig: (_c, _o, genre): RadioRig => ({
        genre,
        play: (_n, t) => played.push({ genre, t }),
        prepare: () => {},
        setLevel: (level, at) => levels.push({ genre, level, at }),
        setFx: () => {},
      }),
    };
    const player = createRadioPlayer(
      ctx as unknown as BaseAudioContext,
      ctx.createGain() as unknown as AudioNode,
      {
        seed: 1,
        band,
      },
    );
    const st: RadioStation = {
      ...pivotFm(),
      tracks: [{ ...pivotFm().tracks[0]!, id: 'x', ref: 'x' }],
    };
    player.select(st);
    for (let t = 0; t <= 0.9; t += 0.05) player.pump(t, true);
    // Four steps of surf, then four of chip, back to back.
    expect(played.slice(0, 8).map((p) => p.genre)).toEqual([
      ...Array<RadioGenre>(4).fill('surf'),
      ...Array<RadioGenre>(4).fill('chip'),
    ]);
    const firstChip = played.find((p) => p.genre === 'chip')!.t;
    // At that moment the chip rig comes up and the surf rig goes quiet.
    expect(levels.some((l) => l.genre === 'chip' && l.level > 0 && Math.abs(l.at - firstChip) < 1e-9)).toBe(
      true,
    );
    expect(levels.some((l) => l.genre === 'surf' && l.level === 0 && Math.abs(l.at - firstChip) < 1e-9)).toBe(
      true,
    );
  });
});

describe('the rider-station machine', () => {
  const near = { distanceM: 30, down: false };
  it('comes on near him, holds, and gives the radio back once he is far', () => {
    const m = createRiderStation();
    expect(m.step(0, { distanceM: RIDER_STATION.inM + 5, down: false }).tune).toBe(false);
    expect(m.step(1, near).tune).toBe(true);
    expect(m.phase()).toBe('on');
    // Far, but not for long enough yet.
    m.step(2, { distanceM: 500, down: false });
    expect(m.phase()).toBe('on');
    expect(m.step(1 + RIDER_STATION.holdS, { distanceM: 500, down: false }).tune).toBe(true);
    expect(m.phase()).toBe('off');
  });

  it('knocked down: dead air, the line once, then the next track when he rides again near you', () => {
    const m = createRiderStation();
    m.step(0, near);
    m.step(1, { distanceM: 20, down: true });
    expect(m.phase()).toBe('dead');
    expect(m.step(1 + RIDER_STATION.deadAirS - 0.1, { distanceM: 20, down: true }).announce).toBe(false);
    expect(m.step(1 + RIDER_STATION.deadAirS, { distanceM: 20, down: true }).announce).toBe(true);
    // Still down beside you: the air stays dead, and the line is not said again.
    const later = 1 + RIDER_STATION.deadAirS + RIDER_STATION.lineS + 1;
    expect(m.step(later, { distanceM: 20, down: true })).toEqual({
      tune: false,
      announce: false,
      nextTrack: false,
    });
    expect(m.phase()).toBe('dead');
    expect(m.step(later + 1, near).nextTrack).toBe(true);
    expect(m.phase()).toBe('on');
  });

  it('knocked down and left behind: your station comes back', () => {
    const m = createRiderStation();
    m.step(0, near);
    m.step(1, { distanceM: 20, down: true });
    m.step(5, { distanceM: 20, down: true });
    expect(m.step(10, { distanceM: 400, down: true }).tune).toBe(true);
    expect(m.phase()).toBe('off');
  });
});

describe('the mixer hands the radio to Pivot FM and back', () => {
  const rider = (id: number, over: Partial<EntitySnapshot> = {}): EntitySnapshot => ({
    id,
    kind: 'rider',
    mode: 'Road',
    road: { edge: 0, s: 0, d: 0, h: 0, dir: 1, yaw: 0 },
    x: 0,
    y: 0,
    z: 0,
    heading: 0,
    speed: 30,
    lean: 0,
    contentId: 'base:player',
    name: 'x',
    faction: 'rider',
    slot: id === 0 ? 0 : -1,
    throttle: 0.5,
    rpm: 5000,
    gear: 2,
    grounded: true,
    health: 100,
    healthMax: 100,
    attackPhase: 'idle',
    heldWeapon: null,
    targetId: -1,
    lastAttackerId: -1,
    progress: 100,
    distanceToFinish: 1000,
    place: 1,
    finished: false,
    ...over,
  });
  const snap = (pivotZ: number | null, mode: EntitySnapshot['mode'] = 'Road'): SimSnapshot => ({
    tick: 1,
    timeScale: 1,
    entities: [
      rider(0),
      ...(pivotZ === null ? [] : [rider(1, { contentId: 'region-sf:pivot', z: pivotZ, mode })]),
    ],
    race: { over: false, routeLength: 4000, finishOrder: [] },
  });
  const plain: RadioStation = {
    id: 'sf-plain',
    packId: 'region-sf',
    name: 'Plain',
    genre: 'synth',
    regions: ['san-francisco'],
    tracks: [
      {
        id: 't',
        title: 'T',
        ref: 'region-sf:station/sf-plain#t',
        origin: 'agent',
        status: 'live',
        procedural: { preset: 'synth-band' },
        audioAsset: null,
      },
    ],
  };
  async function started(radio = 2) {
    const { ctx, create } = fakeContextFactory();
    const lines = new EventTarget();
    const said: unknown[] = [];
    lines.addEventListener(RADIO_BARK_EVENT, (e) => said.push((e as CustomEvent).detail));
    const audio = createAudio({
      createContext: create,
      radioKeys: null,
      barkEvents: lines,
      radioSeed: 5,
      radioBand: RADIO_BAND,
    });
    audio.setStations([plain, pivotFm()]);
    audio.setRegion('region-sf:san-francisco');
    await audio.resume();
    audio.setParam('audio.radio', radio);
    let t = 1;
    const ride = (s: SimSnapshot, seconds: number) => {
      for (let i = 0; i < seconds * 20; i++) {
        t += 0.05;
        ctx.currentTime = t;
        audio.frame(s, 0);
      }
    };
    return { audio, ride, said, radio: () => audio.inspect().radio };
  }

  it('Pivot FM is not on the dial; it takes over while he rides near, and gives it back', async () => {
    const a = await started();
    expect(a.radio().stations).toEqual(['sf-plain']);
    a.ride(snap(-300), 1);
    expect(a.radio().tunedTo).toBe('sf-plain');
    a.ride(snap(-40), 1);
    expect(a.radio().tunedTo).toBe('sf-pivot-fm');
    expect(a.radio().rider.phase).toBe('on');
    expect(a.radio().nowPlaying?.stationName).toBe('Pivot FM');
    a.ride(snap(-400), RIDER_STATION.holdS + 1);
    expect(a.radio().tunedTo).toBe('sf-plain');
    expect(a.audio.inspect().lastCues.filter((c) => c.cue === 'tune')).toHaveLength(2);
  });

  it('knock him down: dead air, his line once, then a new track when he rides again', async () => {
    const a = await started();
    a.ride(snap(-30), 1);
    const before = a.radio().nowPlaying!.ref;
    expect(a.radio().airing).toBe(true);
    a.ride(snap(-30, 'Tumble'), 1);
    expect(a.radio().rider.phase).toBe('dead');
    expect(a.radio().tunedTo).toBe('sf-pivot-fm');
    expect(a.radio().airing).toBe(false);
    expect(a.said).toEqual([]);
    a.ride(snap(-30, 'OnFoot'), RIDER_STATION.deadAirS + RIDER_STATION.lineS);
    expect(a.said).toEqual([
      { contentRef: 'region-sf:bark-set/pivot-core#pivot-fm-next-chapter', speakerName: 'Pivot FM' },
    ]);
    expect(a.radio().rider.lines).toHaveLength(1);
    a.ride(snap(-30), 1);
    expect(a.radio().rider.phase).toBe('on');
    expect(a.radio().airing).toBe(true);
    expect(a.radio().nowPlaying!.ref).not.toBe(before);
  });

  it('never takes a radio that is off, and nothing happens without Pivot in the race', async () => {
    const off = await started(0);
    off.ride(snap(-30), 2);
    expect(off.radio().tunedTo).toBe('off');
    expect(off.radio().rider.phase).toBe('off');
    const alone = await started();
    alone.ride(snap(null), 2);
    expect(alone.radio().tunedTo).toBe('sf-plain');
  });

  it('leaving the race drops it', async () => {
    const a = await started();
    a.ride(snap(-30), 1);
    a.audio.frame(null, 0);
    expect(a.radio().tunedTo).toBe('sf-plain');
    expect(a.radio().rider.phase).toBe('off');
  });
});
