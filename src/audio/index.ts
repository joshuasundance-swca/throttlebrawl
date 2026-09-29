// audio: one AudioContext, created or resumed on the start tap, and the bus graph (docs/
// architecture.md, "Audio"): sources -> music, effects, voices -> master (light limiter) ->
// destination. The skeleton adds one engine tone that follows the player's rpm. audio-1 builds
// the real engine synth, the cues, other riders' engines and the music.
import type { EntitySnapshot, TuningParamDecl } from '../sim/api';

export const AUDIO_TUNING: readonly TuningParamDecl[] = [];

export interface Volumes {
  master: number;
  music: number;
  effects: number;
  voices: number;
}

export interface AudioSystem {
  /** Creates or resumes the context; call inside the start tap's user activation. */
  resume(): Promise<void>;
  /** The four bus gains follow the settings; mute silences master. */
  setVolumes(v: Volumes, mute: boolean): void;
  /** Drives the engine tone from the player's snapshot, once per frame. */
  update(player: Pick<EntitySnapshot, 'rpm' | 'throttle' | 'speed'> | null): void;
  /** Stops sound while paused (the context is suspended, not closed). */
  suspend(): void;
  readonly state: () => 'none' | AudioContextState;
}

interface Graph {
  ctx: AudioContext;
  master: GainNode;
  buses: { music: GainNode; effects: GainNode; voices: GainNode };
  engine: { osc: OscillatorNode; filter: BiquadFilterNode; gain: GainNode };
}

export function createAudio(): AudioSystem {
  let graph: Graph | null = null;
  let volumes: Volumes = { master: 0.8, music: 0.6, effects: 0.9, voices: 0.9 };
  let muted = false;

  const applyVolumes = () => {
    if (!graph) return;
    const t = graph.ctx.currentTime;
    graph.master.gain.setTargetAtTime(muted ? 0 : volumes.master, t, 0.02);
    graph.buses.music.gain.setTargetAtTime(volumes.music, t, 0.02);
    graph.buses.effects.gain.setTargetAtTime(volumes.effects, t, 0.02);
    graph.buses.voices.gain.setTargetAtTime(volumes.voices, t, 0.02);
  };

  const build = (): Graph => {
    const ctx = new AudioContext();
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -6;
    limiter.ratio.value = 12;
    const master = ctx.createGain();
    master.connect(limiter).connect(ctx.destination);
    const bus = () => {
      const g = ctx.createGain();
      g.connect(master);
      return g;
    };
    const buses = { music: bus(), effects: bus(), voices: bus() };
    // Engine: a sawtooth rich in upper harmonics (phone speakers drop the low end), low-passed.
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.value = 40;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 900;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    osc.connect(filter).connect(gain).connect(buses.effects);
    osc.start();
    return { ctx, master, buses, engine: { osc, filter, gain } };
  };

  return {
    async resume() {
      graph ??= build();
      applyVolumes();
      if (graph.ctx.state !== 'running') await graph.ctx.resume();
    },
    setVolumes(v, mute) {
      volumes = v;
      muted = mute;
      applyVolumes();
    },
    update(player) {
      if (!graph || graph.ctx.state !== 'running') return;
      const t = graph.ctx.currentTime;
      const { osc, filter, gain } = graph.engine;
      const rpm = player?.rpm ?? 0;
      osc.frequency.setTargetAtTime(rpm > 0 ? 30 + rpm / 60 : 30, t, 0.03);
      filter.frequency.setTargetAtTime(600 + (player?.throttle ?? 0) * 1800, t, 0.05);
      gain.gain.setTargetAtTime(player ? 0.08 + (player.throttle ?? 0) * 0.1 : 0, t, 0.05);
    },
    suspend() {
      if (graph && graph.ctx.state === 'running') void graph.ctx.suspend();
    },
    state: () => graph?.ctx.state ?? 'none',
  };
}
