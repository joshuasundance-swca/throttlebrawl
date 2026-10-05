// Playtest 1 item 10 (speed cues, [decided]): a wind sound that rises with the player's speed. The
// curve is checked as numbers, and the mixer on the fake context: silent standing still, louder
// with speed, following its sliders, and quiet while down or out of the race.
import { describe, expect, it } from 'vitest';
import type { EntitySnapshot, SimSnapshot } from '../sim/api';
import { fakeContextFactory } from './fake-context';
import { AUDIO_TUNING, createAudio } from './system';
import { WIND_DEFAULTS, windLevel } from './wind';

const P = { gain: WIND_DEFAULTS.gain, fromMps: WIND_DEFAULTS.fromMps, fullMps: WIND_DEFAULTS.fullMps };

function me(over: Partial<EntitySnapshot> = {}): EntitySnapshot {
  return {
    id: 0,
    kind: 'rider',
    mode: 'Road',
    road: { edge: 0, s: 0, d: 0, h: 0, dir: 1, yaw: 0 },
    x: 0,
    y: 0,
    z: 0,
    heading: 0,
    speed: 30,
    lean: 0,
    contentId: 'player',
    name: 'you',
    faction: 'rider',
    slot: 0,
    throttle: 1,
    rpm: 6000,
    gear: 3,
    grounded: true,
    health: 100,
    healthMax: 100,
    attackPhase: 'idle',
    heldWeapon: null,
    targetId: -1,
    lastAttackerId: -1,
    progress: 0,
    distanceToFinish: 1000,
    place: 1,
    finished: false,
    ...over,
  };
}

const snap = (e: EntitySnapshot, timeScale = 1): SimSnapshot => ({
  tick: 10,
  timeScale,
  entities: [e],
  race: { over: false, routeLength: 2000, finishOrder: [] },
});

async function mixer() {
  const { create } = fakeContextFactory();
  const audio = createAudio({ createContext: create });
  await audio.resume();
  return audio;
}

describe('the wind', () => {
  it('is silent below its start speed and swells to its full level at top speed', () => {
    expect(windLevel(0, P)).toBe(0);
    expect(windLevel(P.fromMps, P)).toBe(0);
    const levels = [15, 20, 30, 40].map((v) => windLevel(v, P));
    for (let i = 1; i < levels.length; i++) expect(levels[i]).toBeGreaterThan(levels[i - 1]!);
    expect(windLevel(P.fullMps, P)).toBeCloseTo(P.gain);
    expect(windLevel(P.fullMps + 20, P)).toBeCloseTo(P.gain);
  });

  it('rises with the player speed in the mix', async () => {
    const audio = await mixer();
    audio.frame(snap(me({ speed: 3 })), 0);
    expect(audio.inspect().windLevel).toBe(0);
    audio.frame(snap(me({ speed: 25 })), 0);
    const mid = audio.inspect().windLevel;
    audio.frame(snap(me({ speed: 42 })), 0);
    const fast = audio.inspect().windLevel;
    console.log(`[examined] wind level at 3, 25 and 42 m/s: 0, ${mid.toFixed(3)}, ${fast.toFixed(3)}`);
    expect(mid).toBeGreaterThan(0);
    expect(fast).toBeGreaterThan(mid * 2);
  });

  it('follows its sliders (non-default values change the result)', async () => {
    const audio = await mixer();
    audio.frame(snap(me({ speed: 30 })), 0);
    const base = audio.inspect().windLevel;
    audio.setParam('audio.windGain', 0.6);
    audio.frame(snap(me({ speed: 30 })), 0);
    expect(audio.inspect().windLevel).toBeCloseTo(base * 2);
    audio.setParam('audio.windFromMps', 30);
    audio.frame(snap(me({ speed: 30 })), 0);
    expect(audio.inspect().windLevel).toBe(0);
    audio.setParam('audio.windFromMps', 10);
    audio.setParam('audio.windFullMps', 30);
    audio.frame(snap(me({ speed: 30 })), 0);
    expect(audio.inspect().windLevel).toBeCloseTo(0.6);
    audio.setParam('audio.windGain', 0);
    audio.frame(snap(me({ speed: 30 })), 0);
    expect(audio.inspect().windLevel).toBe(0);
    for (const id of ['audio.windGain', 'audio.windFromMps', 'audio.windFullMps']) {
      const d = AUDIO_TUNING.find((t) => t.id === id);
      expect(d?.affectsSim, id).toBe(false);
      expect(d && d.default >= d.min && d.default <= d.max, id).toBe(true);
    }
  });

  it('drops while the rider is down, in a hit-stop, and out of the race', async () => {
    const audio = await mixer();
    audio.frame(snap(me({ speed: 40 })), 0);
    const riding = audio.inspect().windLevel;
    audio.frame(snap(me({ speed: 40, mode: 'Tumble' })), 0);
    expect(audio.inspect().windLevel).toBe(0);
    audio.frame(snap(me({ speed: 40 }), 0), 0);
    expect(audio.inspect().windLevel).toBeLessThan(riding);
    audio.frame(null, 0);
    expect(audio.inspect().windLevel).toBe(0);
  });
});
