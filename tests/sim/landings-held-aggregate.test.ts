import { describe, expect, it } from 'vitest';
import { memoCases } from './case-results';
import { checkHeld, type heldCheck } from './landings-held';

type Rows = ReturnType<ReturnType<typeof heldCheck>['complete']>;
const row = (held: number, down: string[] = [], road: string[] = []) => ({ held, down, road });
// Exercise the real pooled assertion without stepping a race. These are explicit result fixtures.
const check = (complete: () => Rows) =>
  checkHeld('brake held to the ground', { cases: [], run: () => row(0), complete });

describe('held landing pooled oracle fixtures', () => {
  it('retains the global six-jump floor while allowing zero-jump individual routes', () => {
    expect(() => check(() => [row(0), row(2), row(1), row(3)])).not.toThrow();
    expect(() => check(() => [row(0), row(2), row(1), row(2)])).toThrow();
  });
  it('retains every ordered command-attributed down and permits only classified road downs', () => {
    expect(() => check(() => [row(6, [], ['road-only crash'])])).not.toThrow();
    expect(() => check(() => [row(6), row(0, ['command crash'])])).toThrow();
  });
  it('cannot pass with missing or failed required work, even when partial jumps already meet six', () => {
    const missing = memoCases(['a', 'b'], () => row(6));
    missing.get('a');
    expect(() => check(missing.results)).toThrow(/missing/i);
    expect(() => check(missing.complete)).not.toThrow();
    const failed = memoCases(['a', 'b'], (key) => {
      if (key === 'b') throw new Error('required route failed');
      return row(6);
    });
    failed.get('a');
    expect(() => check(failed.complete)).toThrow(/required route failed/);
    expect(() => check(failed.complete)).toThrow(/required route failed/);
  });
});
