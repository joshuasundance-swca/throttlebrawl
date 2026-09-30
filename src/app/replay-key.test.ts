// The replay key's code part (docs/architecture.md, "Replay and input recording"; M2 app-3 item
// 4): the sim chunk's code hash in a production build, the build id where there is none (dev,
// tests), so a key never carries the placeholder.
import { describe, expect, it } from 'vitest';
import { appReplayKey } from './replay-key';

describe('app: the replay key', () => {
  it('uses the sim chunk hash when the build injected one', () => {
    expect(appReplayKey({ id: 'abc1234', simCodeHash: '3a4301e71cbf' }, '0badf00d')).toBe(
      '3a4301e71cbf+0badf00d',
    );
  });

  it('falls back to the build id without one, or with the placeholder', () => {
    expect(appReplayKey({ id: 'abc1234' }, '0badf00d')).toBe('abc1234+0badf00d');
    expect(appReplayKey({ id: 'abc1234', simCodeHash: 'SIMCODE_NONE' }, '0badf00d')).toBe('abc1234+0badf00d');
    expect(appReplayKey({ id: 'abc1234', simCodeHash: '' }, '0badf00d')).toBe('abc1234+0badf00d');
  });
});
