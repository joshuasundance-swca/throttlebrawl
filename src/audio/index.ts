// audio: one AudioContext, created or resumed on the start tap, and the bus graph (docs/
// architecture.md, "Audio"): sources -> music, effects, voices -> master -> light limiter ->
// ceiling (M2) -> destination. audio-1 (M1.md) fills it in: the synthesized engine for the player and, cheaper,
// for nearby riders with distance and Doppler; synthesized cues for punch, kick, hit, miss and
// crash, played the moment their event arrives (the hit-stop tick); the oncoming-traffic horn and
// the cop's siren as telegraphs; a crude original music loop; and a cap on voices.
//
// audio-2 (M2.md, the mix) adds cues for the M2 events (takedown, slow motion, rail, splash,
// respawn, style cash, the steal glint, wobbles and close passes), crashes layered by impact, the
// slow-motion treatment (slowmo.ts: effects pitched down and low-passed, music ducked) and the
// fuller sixteen-bar score. Every feel number is a presentation tuning slider below.
//
// Wiring (app/): `frame(snapshot, playerId)` once per rendered frame drives everything placed in
// the world; `onEvents(events)` after each sim step plays the cues. The skeleton's
// `update(player)` still works and drives the player's engine and the music alone.
import type { EntitySnapshot, SimEvent, SimSnapshot, TuningParamDecl } from '../sim/api';
import { CUE_PATCHES, createSirenVoice, type SirenVoice } from './cue-patches';
import { createCeiling } from './ceiling';
import { cueForEvent, type CueId } from './cues';
import { createSlowmoTreatment, SLOWMO_DEFAULTS, type SlowmoTreatment } from './slowmo';
import {
  createEngineVoice,
  resolveEngineProfile,
  type EngineSoundSpec,
  type EngineVoice,
} from './engine-patch';
import { createMusic, type MusicLoop } from './music';
import { distance, distanceGain, dopplerFactor, moving } from './spatial';
import { findHonks, findSiren, HORN_DEFAULTS } from './telegraphs';
import { VoicePool, type PoolEntry } from './voices';
import { createWindVoice, WIND_DEFAULTS, type WindVoice } from './wind';

export { ENGINE_PRESETS, resolveEngineProfile } from './engine-patch';
export type { EngineProfile, EngineSoundSpec } from './engine-patch';
export { CUE_IDS, EVENT_CUES } from './cues';
export { SLOWMO_DEFAULTS } from './slowmo';
export type { CueId } from './cues';

/** Presentation-only tuning (applies at once, never recorded; docs/architecture.md, "Tuning"). */
export const AUDIO_TUNING: readonly TuningParamDecl[] = [
  {
    id: 'audio.engineGain',
    group: 'audio',
    label: 'Engine level',
    default: 1,
    min: 0,
    max: 2,
    step: 0.05,
    unit: '',
    affectsSim: false,
  },
  {
    id: 'audio.cueGain',
    group: 'audio',
    label: 'Hit and cue level',
    default: 1,
    min: 0,
    max: 2,
    step: 0.05,
    unit: '',
    affectsSim: false,
  },
  {
    id: 'audio.maxVoices',
    group: 'audio',
    label: 'Voice cap',
    default: 32,
    min: 4,
    max: 64,
    step: 1,
    unit: '',
    affectsSim: false,
  },
  {
    id: 'audio.dopplerScale',
    group: 'audio',
    label: 'Doppler',
    default: 1,
    min: 0,
    max: 2,
    step: 0.1,
    unit: '',
    affectsSim: false,
  },
  {
    id: 'audio.hornRangeM',
    group: 'audio',
    label: 'Horn range (0 = off)',
    default: HORN_DEFAULTS.rangeM,
    min: 0,
    max: 150,
    step: 5,
    unit: 'm',
    affectsSim: false,
  },
  {
    id: 'audio.hornLaneHalfWidthM',
    group: 'audio',
    label: 'Horn: your line half-width',
    default: HORN_DEFAULTS.laneHalfWidthM,
    min: 0.5,
    max: 4,
    step: 0.1,
    unit: 'm',
    affectsSim: false,
  },
  {
    id: 'audio.slowmoLowpassHz',
    group: 'audio',
    label: 'Slow motion: effects low-pass',
    default: SLOWMO_DEFAULTS.lowpassHz,
    min: 200,
    max: 20000,
    step: 50,
    unit: 'Hz',
    affectsSim: false,
  },
  {
    id: 'audio.slowmoPitchSemis',
    group: 'audio',
    label: 'Slow motion: pitch',
    default: SLOWMO_DEFAULTS.pitchSemis,
    min: -12,
    max: 0,
    step: 0.5,
    unit: 'st',
    affectsSim: false,
  },
  {
    id: 'audio.slowmoMusicDuck',
    group: 'audio',
    label: 'Slow motion: music level',
    default: SLOWMO_DEFAULTS.musicDuck,
    min: 0,
    max: 1,
    step: 0.05,
    unit: '',
    affectsSim: false,
  },
  {
    id: 'audio.crashImpactScale',
    group: 'audio',
    label: 'Crash size from impact',
    default: 1,
    min: 0,
    max: 2,
    step: 0.1,
    unit: '',
    affectsSim: false,
  },
  // Playtest 1 item 10 (speed cues): the wind rises with your speed (wind.ts).
  {
    id: 'audio.windGain',
    group: 'audio',
    label: 'Wind level (0 = off)',
    default: WIND_DEFAULTS.gain,
    min: 0,
    max: 1,
    step: 0.05,
    unit: '',
    affectsSim: false,
  },
  {
    id: 'audio.windFromMps',
    group: 'audio',
    label: 'Wind: starts at',
    default: WIND_DEFAULTS.fromMps,
    min: 0,
    max: 40,
    step: 1,
    unit: 'm/s',
    affectsSim: false,
  },
  {
    id: 'audio.windFullMps',
    group: 'audio',
    label: 'Wind: full at',
    default: WIND_DEFAULTS.fullMps,
    min: 10,
    max: 80,
    step: 1,
    unit: 'm/s',
    affectsSim: false,
  },
];

export interface Volumes {
  master: number;
  music: number;
  effects: number;
  voices: number;
}

/**
 * Gains the buses aim for. Sliders are 0..1 with a squared taper, so the middle of a slider
 * sounds like the middle; mute silences master and leaves the bus settings alone.
 */
export function busTargets(v: Volumes, mute: boolean): Volumes {
  const taper = (x: number) => {
    const c = Number.isFinite(x) ? Math.min(1, Math.max(0, x)) : 0;
    return c * c;
  };
  return {
    master: mute ? 0 : taper(v.master),
    music: taper(v.music),
    effects: taper(v.effects),
    voices: taper(v.voices),
  };
}

export interface AudioInspect {
  state: 'none' | AudioContextState;
  busTargets: Volumes;
  activeVoices: number;
  /** The most recent cues played (up to 32), with their start times on the audio clock. */
  lastCues: { cue: CueId; at: number }[];
  playerEngineHz: number;
  playerEngineLevel: number;
  /** Entity ids of the other riders whose engines are playing. */
  otherEngines: number[];
  sirenLevel: number;
  musicPlaying: boolean;
  /** The slow-motion treatment: whether it is on, and what the bus filter and music duck aim for. */
  slowmo: { active: boolean; lowpassHz: number; musicLevel: number; pitch: number };
  /** The level the wind aims for (0 = silent). */
  windLevel: number;
}

export interface AudioSystem {
  /** Creates or resumes the context; call inside the start tap's user activation. */
  resume(): Promise<void>;
  /** The four bus gains follow the settings; mute silences master. */
  setVolumes(v: Volumes, mute: boolean): void;
  /** Skeleton path: drives only the player's engine and the music. `null` = not racing. */
  update(player: Pick<EntitySnapshot, 'rpm' | 'throttle' | 'speed'> | null): void;
  /** Once per rendered frame: engines, telegraphs, hit-stop ducking and music. `null` = not racing. */
  frame(snapshot: SimSnapshot | null, playerId: number): void;
  /** After each sim step: plays the cue of each event now, so a hit lands on its hit-stop tick. */
  onEvents(events: readonly SimEvent[], snapshot?: SimSnapshot | null): void;
  /** Presentation tuning (AUDIO_TUNING ids); unknown ids are ignored. */
  setParam(id: string, value: number): void;
  /** Engine sounds by rider content id (from each rider's bike's `engineSound`). */
  setEngineSounds(byRider: Readonly<Record<string, EngineSoundSpec>>): void;
  /** Stops sound while paused (the context is suspended, not closed). */
  suspend(): void;
  readonly state: () => 'none' | AudioContextState;
  /** What the mixer is doing, for tests and the debug report. */
  inspect(): AudioInspect;
}

export interface AudioOptions {
  /** Makes the context; tests pass a fake. */
  createContext?: () => AudioContext;
  /**
   * The context is an OfflineAudioContext driven by a test render: treat it as live while its
   * rendering is suspended, and never call its `resume()` from `resume()`.
   */
  offline?: boolean;
}

interface Graph {
  ctx: AudioContext;
  master: GainNode;
  buses: { music: GainNode; effects: GainNode; voices: GainNode };
  /** Every effects source feeds `slowmo.fxIn`; the music feeds `slowmo.musicIn`. */
  slowmo: SlowmoTreatment;
  music: MusicLoop;
}

interface Held<T> {
  voice: T;
  entry: PoolEntry;
  contentId: string;
}

/** Priorities in the voice pool (cues are 45..105, see cues.ts). */
const PRIORITY = { playerEngine: 200, siren: 90, otherEngine: 30 } as const;
const OTHER_ENGINES_MAX = 5;
const OTHER_ENGINES_RANGE_M = 150;

export function createAudio(opts: AudioOptions = {}): AudioSystem {
  const createContext = opts.createContext ?? (() => new AudioContext());
  let graph: Graph | null = null;
  let volumes: Volumes = { master: 0.8, music: 0.6, effects: 0.9, voices: 0.9 };
  let muted = false;
  const params = {
    engineGain: 1,
    cueGain: 1,
    maxVoices: 32,
    dopplerScale: 1,
    hornRangeM: HORN_DEFAULTS.rangeM,
    hornLaneHalfWidthM: HORN_DEFAULTS.laneHalfWidthM,
    slowmoLowpassHz: SLOWMO_DEFAULTS.lowpassHz,
    slowmoPitchSemis: SLOWMO_DEFAULTS.pitchSemis,
    slowmoMusicDuck: SLOWMO_DEFAULTS.musicDuck,
    crashImpactScale: 1,
    windGain: WIND_DEFAULTS.gain as number,
    windFromMps: WIND_DEFAULTS.fromMps as number,
    windFullMps: WIND_DEFAULTS.fullMps as number,
  };
  const windParams = () => ({
    gain: params.windGain,
    fromMps: params.windFromMps,
    fullMps: params.windFullMps,
  });
  /** The wind's voice, made on the first racing frame (outside the voice pool, like the music). */
  let wind: WindVoice | null = null;
  const slowmoParams = () => ({
    lowpassHz: params.slowmoLowpassHz,
    pitchSemis: params.slowmoPitchSemis,
    musicDuck: params.slowmoMusicDuck,
  });
  /** Slow motion as the events last said, for snapshots that do not carry `slowmo`. */
  let slowmoByEvents = false;
  let engineSounds: Readonly<Record<string, EngineSoundSpec>> = {};
  const pool = new VoicePool(params.maxVoices);
  let playerEngine: Held<EngineVoice> | null = null;
  const others = new Map<number, Held<EngineVoice>>();
  let siren: Held<SirenVoice> | null = null;
  const lastHonk = new Map<number, number>();
  const lastCues: { cue: CueId; at: number }[] = [];
  let lastSnap: SimSnapshot | null = null;
  let lastPlayerId = 0;

  const applyVolumes = () => {
    if (!graph) return;
    const t = graph.ctx.currentTime;
    const g = busTargets(volumes, muted);
    graph.master.gain.setTargetAtTime(g.master, t, 0.02);
    graph.buses.music.gain.setTargetAtTime(g.music, t, 0.02);
    graph.buses.effects.gain.setTargetAtTime(g.effects, t, 0.02);
    graph.buses.voices.gain.setTargetAtTime(g.voices, t, 0.02);
  };

  const build = (): Graph => {
    const ctx = createContext();
    // A light limiter so crashes do not clip on phone speakers.
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -6;
    limiter.knee.value = 4;
    limiter.ratio.value = 12;
    limiter.attack.value = 0.003;
    limiter.release.value = 0.15;
    // The ceiling after it guarantees a pile-up saturates instead of clipping (ceiling.ts).
    limiter.connect(createCeiling(ctx, ctx.destination));
    // Every gain starts at its setting, so the first frame has no swell from the defaults.
    const start = busTargets(volumes, muted);
    const master = ctx.createGain();
    master.gain.value = start.master;
    master.connect(limiter);
    const bus = (level: number) => {
      const g = ctx.createGain();
      g.gain.value = level;
      g.connect(master);
      return g;
    };
    const buses = { music: bus(start.music), effects: bus(start.effects), voices: bus(start.voices) };
    const slowmo = createSlowmoTreatment(ctx, buses.effects, buses.music, slowmoParams());
    return { ctx, master, buses, slowmo, music: createMusic(ctx, slowmo.musicIn) };
  };

  const live = (): Graph | null => (graph && (opts.offline || graph.ctx.state === 'running') ? graph : null);

  /** Registers a long-lived voice in the pool; if it is ever stolen, `onLost` forgets it. */
  const hold = <T extends { stop(): void }>(
    priority: number,
    voice: T,
    onLost: () => void,
  ): PoolEntry | null =>
    pool.add(priority, {
      stop: () => {
        voice.stop();
        onLost();
      },
    });

  const dropPlayerEngine = () => {
    if (!playerEngine) return;
    pool.release(playerEngine.entry);
    playerEngine.voice.stop();
    playerEngine = null;
  };
  const dropOther = (id: number) => {
    const h = others.get(id);
    if (!h) return;
    pool.release(h.entry);
    h.voice.stop();
    others.delete(id);
  };
  const dropSiren = () => {
    if (!siren) return;
    pool.release(siren.entry);
    siren.voice.stop();
    siren = null;
  };

  const engineFor = (g: Graph, contentId: string): Held<EngineVoice> | null => {
    if (playerEngine && playerEngine.contentId === contentId) return playerEngine;
    dropPlayerEngine();
    const voice = createEngineVoice(
      g.ctx,
      g.slowmo.fxIn,
      resolveEngineProfile(engineSounds[contentId]),
      'full',
    );
    const held: Held<EngineVoice> = { voice, contentId, entry: null as unknown as PoolEntry };
    const entry = hold(PRIORITY.playerEngine, voice, () => {
      if (playerEngine === held) playerEngine = null;
    });
    if (!entry) return null;
    held.entry = entry;
    return (playerEngine = held);
  };

  const drivePlayer = (
    g: Graph,
    me: Pick<EntitySnapshot, 'rpm' | 'throttle'> & Partial<Pick<EntitySnapshot, 'mode' | 'contentId'>>,
    hitStop: boolean,
  ) => {
    const held = engineFor(g, me.contentId ?? 'player');
    if (!held) return;
    const down = me.mode === 'Tumble' || me.mode === 'OnFoot';
    held.voice.set(down ? { rpm: 0, throttle: 0 } : { rpm: me.rpm, throttle: me.throttle });
    held.voice.setLevel(0.5 * params.engineGain * (down ? 0.3 : 1) * (hitStop ? 0.3 : 1));
    held.voice.setDoppler(g.slowmo.pitch());
  };

  const silenceScene = (g: Graph) => {
    slowmoByEvents = false;
    g.slowmo.set(false);
    playerEngine?.voice.setLevel(0);
    wind?.set(0, windParams());
    for (const id of [...others.keys()]) dropOther(id);
    dropSiren();
    g.music.pump(g.ctx.currentTime, false, 0);
  };

  /** Cues that mark the slow motion's edges play at their own pitch. */
  const UNPITCHED: ReadonlySet<CueId> = new Set(['slowIn', 'slowOut']);

  const playCue = (g: Graph, cue: CueId, priority: number, gain: number, impact = 1) => {
    const level = gain * params.cueGain;
    if (level <= 0.001) return;
    const at = g.ctx.currentTime;
    const pitch = UNPITCHED.has(cue) ? 1 : g.slowmo.pitch();
    const playing = CUE_PATCHES[cue](g.ctx, g.slowmo.fxIn, at, level, { impact, pitch });
    const entry = pool.add(priority, playing);
    if (!entry) return;
    playing.onEnded(() => pool.release(entry));
    lastCues.push({ cue, at });
    if (lastCues.length > 32) lastCues.shift();
  };

  const findEntity = (snap: SimSnapshot, id: number): EntitySnapshot | null => {
    const e = snap.entities[id];
    return e && e.id === id ? e : (snap.entities.find((x) => x.id === id) ?? null);
  };

  const scene = (g: Graph, snap: SimSnapshot, me: EntitySnapshot) => {
    const now = g.ctx.currentTime;
    const hitStop = snap.timeScale === 0;
    // The snapshot's slow motion is the truth when it carries it (after a resume, too).
    if (snap.slowmo) slowmoByEvents = snap.slowmo.active;
    g.slowmo.set(slowmoByEvents);
    const pitch = g.slowmo.pitch();
    drivePlayer(g, me, hitStop);
    // The wind: your speed, heard. Off while you tumble or run, and ducked in a hit-stop.
    wind ??= createWindVoice(g.ctx, g.slowmo.fxIn);
    const down = me.mode === 'Tumble' || me.mode === 'OnFoot';
    wind.set(me.speed, windParams(), down ? 0 : hitStop ? 0.3 : 1);
    const listener = moving(me);

    // Other riders' engines: the nearest few, cheaper patch, distance and Doppler.
    const near = snap.entities
      .filter((e) => e.kind === 'rider' && e.id !== me.id && e.mode !== 'Tumble' && e.mode !== 'OnFoot')
      .map((e) => ({ e, d: distance(me, e) }))
      .filter((x) => x.d < OTHER_ENGINES_RANGE_M)
      .sort((a, b) => a.d - b.d)
      .slice(0, OTHER_ENGINES_MAX);
    const keep = new Set(near.map((x) => x.e.id));
    for (const id of [...others.keys()]) if (!keep.has(id)) dropOther(id);
    for (const { e, d } of near) {
      let held = others.get(e.id);
      if (held && held.contentId !== e.contentId) {
        dropOther(e.id);
        held = undefined;
      }
      if (!held) {
        const voice = createEngineVoice(
          g.ctx,
          g.slowmo.fxIn,
          resolveEngineProfile(engineSounds[e.contentId]),
          'lite',
        );
        const id = e.id;
        const h: Held<EngineVoice> = { voice, contentId: e.contentId, entry: null as unknown as PoolEntry };
        const entry = hold(PRIORITY.otherEngine, voice, () => {
          if (others.get(id) === h) others.delete(id);
        });
        if (!entry) continue;
        h.entry = entry;
        others.set(id, (held = h));
      }
      held.voice.set({ rpm: e.rpm, throttle: e.throttle });
      held.voice.setLevel(0.35 * params.engineGain * distanceGain(d) * (hitStop ? 0.3 : 1));
      held.voice.setDoppler(pitch * dopplerFactor(listener, moving(e), params.dopplerScale));
    }

    // The siren while the cop is near.
    const cop = findSiren(me, snap.entities);
    if (cop) {
      if (!siren) {
        const voice = createSirenVoice(g.ctx, g.slowmo.fxIn);
        const h: Held<SirenVoice> = { voice, contentId: cop.contentId, entry: null as unknown as PoolEntry };
        const entry = hold(PRIORITY.siren, voice, () => {
          if (siren === h) siren = null;
        });
        if (entry) {
          h.entry = entry;
          siren = h;
        }
      }
      if (siren) {
        siren.voice.setLevel(0.45 * params.cueGain * distanceGain(distance(me, cop), 12, 250));
        siren.voice.setDoppler(pitch * dopplerFactor(listener, moving(cop), params.dopplerScale));
      }
    } else dropSiren();

    // Oncoming traffic honks once as it closes in your line.
    if (params.hornRangeM > 0) {
      const honks = findHonks(me, snap.entities, now, lastHonk, {
        ...HORN_DEFAULTS,
        rangeM: params.hornRangeM,
        laneHalfWidthM: params.hornLaneHalfWidthM,
      });
      for (const h of honks) {
        playCue(g, h.truck ? 'truckHorn' : 'horn', h.truck ? 62 : 60, distanceGain(h.distanceM, 25, 220));
      }
    }

    // Music: the lead comes in with speed.
    g.music.pump(now, true, 0.35 + 0.65 * Math.min(1, Math.max(0, me.speed / 35)));
  };

  return {
    async resume() {
      graph ??= build();
      applyVolumes();
      if (!opts.offline && graph.ctx.state !== 'running') await graph.ctx.resume();
    },
    setVolumes(v, mute) {
      volumes = v;
      muted = mute;
      applyVolumes();
    },
    update(player) {
      const g = live();
      if (!g) return;
      if (!player) {
        silenceScene(g);
        return;
      }
      drivePlayer(g, { ...player, contentId: playerEngine?.contentId ?? 'player' }, false);
      g.music.pump(g.ctx.currentTime, true, 0.35 + 0.65 * Math.min(1, Math.max(0, player.speed / 35)));
    },
    frame(snapshot, playerId) {
      lastSnap = snapshot;
      lastPlayerId = playerId;
      const g = live();
      if (!g) return;
      const me = snapshot ? findEntity(snapshot, playerId) : null;
      if (!snapshot || !me) {
        silenceScene(g);
        return;
      }
      scene(g, snapshot, me);
    },
    onEvents(events, snapshot) {
      const g = live();
      if (!g) return;
      const snap = snapshot ?? lastSnap;
      const me = snap ? findEntity(snap, lastPlayerId) : null;
      for (const e of events) {
        // The slow motion starts on its event's tick, before the next frame's snapshot says so.
        if (e.type === 'slowmoStart' || e.type === 'slowmoEnd') {
          slowmoByEvents = e.type === 'slowmoStart';
          g.slowmo.set(slowmoByEvents);
        }
        const src = snap ? findEntity(snap, e.actor) : null;
        const choice = cueForEvent(e, lastPlayerId, src ? src.speed : null);
        if (!choice) continue;
        let gain = 1;
        if (!choice.playerInvolved && snap && me) {
          gain = src ? distanceGain(distance(me, src), 8, 180) : 0.6;
        }
        const impact = Math.min(1, choice.impact * params.crashImpactScale);
        playCue(g, choice.cue, choice.priority, gain, impact);
      }
    },
    setParam(id, value) {
      if (!Number.isFinite(value)) return;
      switch (id) {
        case 'audio.engineGain':
          params.engineGain = value;
          break;
        case 'audio.cueGain':
          params.cueGain = value;
          break;
        case 'audio.maxVoices':
          params.maxVoices = value;
          pool.setMax(value);
          break;
        case 'audio.dopplerScale':
          params.dopplerScale = value;
          break;
        case 'audio.hornRangeM':
          params.hornRangeM = value;
          break;
        case 'audio.hornLaneHalfWidthM':
          params.hornLaneHalfWidthM = value;
          break;
        case 'audio.slowmoLowpassHz':
          params.slowmoLowpassHz = value;
          graph?.slowmo.setParams(slowmoParams());
          break;
        case 'audio.slowmoPitchSemis':
          params.slowmoPitchSemis = value;
          graph?.slowmo.setParams(slowmoParams());
          break;
        case 'audio.slowmoMusicDuck':
          params.slowmoMusicDuck = value;
          graph?.slowmo.setParams(slowmoParams());
          break;
        case 'audio.crashImpactScale':
          params.crashImpactScale = value;
          break;
        case 'audio.windGain':
          params.windGain = value;
          break;
        case 'audio.windFromMps':
          params.windFromMps = value;
          break;
        case 'audio.windFullMps':
          params.windFullMps = value;
          break;
      }
    },
    setEngineSounds(byRider) {
      engineSounds = byRider;
      // Rebuilt with the new profile on the next frame.
      dropPlayerEngine();
      for (const id of [...others.keys()]) dropOther(id);
    },
    suspend() {
      if (graph && graph.ctx.state === 'running') void graph.ctx.suspend();
    },
    state: () => graph?.ctx.state ?? 'none',
    inspect: () => ({
      state: graph?.ctx.state ?? 'none',
      busTargets: busTargets(volumes, muted),
      activeVoices: pool.size,
      lastCues: lastCues.slice(),
      playerEngineHz: playerEngine?.voice.hz() ?? 0,
      playerEngineLevel: playerEngine?.voice.level() ?? 0,
      otherEngines: [...others.keys()].sort((a, b) => a - b),
      sirenLevel: siren?.voice.level() ?? 0,
      musicPlaying: graph?.music.playing() ?? false,
      slowmo: {
        active: graph?.slowmo.active() ?? false,
        lowpassHz: graph?.slowmo.lowpassTarget() ?? 0,
        musicLevel: graph?.slowmo.musicTarget() ?? 1,
        pitch: graph?.slowmo.pitch() ?? 1,
      },
      windLevel: wind?.level() ?? 0,
    }),
  };
}
