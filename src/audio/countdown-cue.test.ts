import { describe, expect, it } from 'vitest';
import { CUE_PATCHES } from './cue-patches';
import { CUE_IDS } from './cues';
import { fakeContextFactory, FakeAudioContext } from './fake-context';
import { createAudio } from './system';

// The countdown's beep (playtest 4, P4-11): one short tone a beat for 3, 2 and 1, quieter than the
// GO cue the sim's raceStart event already plays, and sent through the effects bus like every cue,
// so it follows the Effects slider and the quieter default mix (P4-18) instead of sitting over it.

/** The loudest level any gain envelope of the patch reaches, and the frequencies it plays. */
function shape(cue: 'countBeat' | 'go') {
  const ctx = new FakeAudioContext();
  const out = ctx.createGain();
  CUE_PATCHES[cue](ctx as unknown as BaseAudioContext, out as unknown as AudioNode, 0, 1);
  const envelopes = ctx.nodes.filter((n) => n.kind === 'gain' && n !== out && n.gain.calls.length > 0);
  const peak = Math.max(...envelopes.flatMap((n) => n.gain.calls.map((c) => c.value)));
  const hz = ctx.nodes.filter((n) => n.kind === 'oscillator').map((n) => n.frequency.value);
  return { peak, hz };
}

describe('the countdown beep', () => {
  it('is a cue with a patch', () => {
    expect(CUE_IDS).toContain('countBeat');
    expect(CUE_PATCHES.countBeat).toBeTypeOf('function');
  });

  it('is quieter than GO and lower than it, so GO is the one that reads as the start', () => {
    const beat = shape('countBeat');
    const go = shape('go');
    expect(beat.peak).toBeGreaterThan(0);
    expect(beat.peak).toBeLessThan(go.peak);
    expect(Math.max(...beat.hz)).toBeLessThan(Math.min(...go.hz));
  });

  it('plays through the engine, and is heard once a beat', async () => {
    const { ctx, create } = fakeContextFactory();
    const audio = createAudio({ createContext: create });
    await audio.resume();
    ctx.currentTime = 1;
    audio.countdownBeat(3);
    ctx.currentTime = 2;
    audio.countdownBeat(2);
    const heard = audio.inspect().lastCues.filter((c) => c.cue === 'countBeat');
    expect(heard).toHaveLength(2);
  });
});
