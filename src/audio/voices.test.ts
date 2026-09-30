import { describe, expect, it } from 'vitest';
import { VoicePool } from './voices';

const voice = (log: string[], name: string) => ({ stop: () => log.push(`stop ${name}`) });

describe('VoicePool', () => {
  it('never holds more voices than the cap', () => {
    const log: string[] = [];
    const pool = new VoicePool(4);
    for (let i = 0; i < 10; i++) pool.add(50, voice(log, `v${i}`));
    expect(pool.size).toBe(4);
  });

  it('steals the lowest-priority, then oldest, voice for a higher-priority one', () => {
    const log: string[] = [];
    const pool = new VoicePool(3);
    pool.add(80, voice(log, 'engine'));
    pool.add(30, voice(log, 'old-horn'));
    pool.add(30, voice(log, 'new-horn'));
    expect(pool.add(70, voice(log, 'punch'))).not.toBeNull();
    expect(log).toEqual(['stop old-horn']);
    expect(pool.size).toBe(3);
  });

  it('drops a new voice that ranks below everything playing', () => {
    const log: string[] = [];
    const pool = new VoicePool(2);
    pool.add(90, voice(log, 'a'));
    pool.add(90, voice(log, 'b'));
    expect(pool.add(10, voice(log, 'quiet'))).toBeNull();
    expect(log).toEqual(['stop quiet']);
    expect(pool.size).toBe(2);
  });

  it('frees a slot when a voice is released, and shrinking the cap stops the extras', () => {
    const log: string[] = [];
    const pool = new VoicePool(3);
    const a = pool.add(50, voice(log, 'a'));
    pool.add(60, voice(log, 'b'));
    pool.add(70, voice(log, 'c'));
    if (a) pool.release(a);
    expect(pool.size).toBe(2);
    pool.setMax(1);
    expect(pool.size).toBe(1);
    expect(log).toEqual(['stop b']);
  });
});
