// Dial-Up's Bad Connection ghost (run W-U): which riders draw see-through, and how it flickers. The
// events and snapshot fields are the sim's own (sim/types.ts `badConnection`; tests/sim/
// career-polish.test.ts checks the sim keeps his signature at lag/act from drop to reconnect).
import { describe, expect, it } from 'vitest';
import type { EntitySnapshot, SignatureId, SignaturePhase, SimEvent } from '../../sim/api';
import { frozenInLag, ghostOpacity, Ghosts, GHOST_REJOIN_S, rejoinOpacity } from './ghost';

const rider = (id: number, over: Partial<EntitySnapshot> = {}): EntitySnapshot =>
  ({ id, kind: 'rider', mode: 'Road', signature: null, ...over }) as EntitySnapshot;
const sig = (move: SignatureId, phase: SignaturePhase) => ({
  move,
  phase,
  seconds: 0,
  left: -1,
  targetId: -1,
});
const frozen = (id: number) => rider(id, { signature: sig('lag', 'act') });
const bad = (actor: number, phase: string, tick = 1): SimEvent => ({
  tick,
  type: 'badConnection',
  actor,
  data: { phase },
});

/** The levels over one wall-clock second at 60 frames a second. */
const second = (g: Ghosts, e: EntitySnapshot, from: number) =>
  Array.from({ length: 60 }, (_, i) => g.opacity(e, from + i / 60));

describe('the Bad Connection ghost', () => {
  it('a dropped connection draws him see-through, flickering at an uneven rate', () => {
    const g = new Ghosts();
    g.push([bad(3, 'screech')], 0);
    // The warning alone (the screech) is not a ghost yet.
    expect(g.opacity(rider(3, { signature: sig('lag', 'tell') }), 0.1)).toBe(1);
    g.push([bad(3, 'drop')], 0.75);
    const levels = second(g, frozen(3), 0.75);
    for (const v of levels) {
      expect(v).toBeGreaterThan(0.05);
      expect(v).toBeLessThan(0.6);
    }
    // A flicker, not a fade: several different levels in the second, and many changes.
    expect(new Set(levels).size).toBeGreaterThanOrEqual(6);
    const changes = levels.filter((v, i) => i > 0 && v !== levels[i - 1]).length;
    expect(changes).toBeGreaterThanOrEqual(10);
  });

  it('he glitches back in on the reconnect, then draws solid', () => {
    const g = new Ghosts();
    g.push([bad(3, 'screech'), bad(3, 'drop')], 0);
    expect(g.opacity(frozen(3), 0.5)).toBeLessThan(1);
    g.push([bad(3, 'reconnect')], 1);
    const back = rider(3, { signature: sig('lag', 'open') });
    const glitch = Array.from({ length: 20 }, (_, i) => g.opacity(back, 1 + (i * GHOST_REJOIN_S) / 20));
    expect(glitch).toContain(1);
    expect(glitch.some((v) => v < 1)).toBe(true);
    expect(g.opacity(back, 1 + GHOST_REJOIN_S + 0.01)).toBe(1);
    expect(g.opacity(back, 5)).toBe(1);
  });

  it('only the rider who dropped: everyone else, and his plain lag outside the grudge, stay solid', () => {
    const g = new Ghosts();
    g.push([bad(3, 'drop')], 0);
    expect(g.opacity(frozen(4), 0.2)).toBe(1);
    // Dial-Up's ordinary lag freezes too, but sends no badConnection: no ghost.
    const plain = new Ghosts();
    expect(second(plain, frozen(3), 0).every((v) => v === 1)).toBe(true);
  });

  it('never leaves a ghost behind: a fall mid-drop, or a snapshot that moved on, is solid for good', () => {
    const g = new Ghosts();
    g.push([bad(3, 'drop')], 0);
    expect(g.opacity(rider(3, { mode: 'Tumble', signature: null }), 0.3)).toBe(1);
    // Back on the bike and frozen again with no new drop event: still solid.
    expect(g.opacity(frozen(3), 0.4)).toBe(1);
    // A reconnect for a rider never seen dropped does not glitch.
    g.push([bad(3, 'reconnect')], 0.5);
    expect(g.opacity(rider(3), 0.55)).toBe(1);
  });

  it('frozenInLag reads the snapshot the sim fills', () => {
    expect(frozenInLag(frozen(1))).toBe(true);
    expect(frozenInLag(rider(1))).toBe(false);
    expect(frozenInLag(rider(1, { signature: sig('selfie', 'act') }))).toBe(false);
    expect(frozenInLag(rider(1, { mode: 'OnFoot', signature: sig('lag', 'act') }))).toBe(false);
  });

  it('the levels are pure functions of the clock (so two riders can be staggered)', () => {
    expect(ghostOpacity(1.25, 0)).toBe(ghostOpacity(1.25, 0));
    expect([0, 1, 2, 3].map((s) => ghostOpacity(0.5, s * 5))).not.toEqual(
      [0, 0, 0, 0].map(() => ghostOpacity(0.5, 0)),
    );
    expect(rejoinOpacity(0)).toBe(1);
    expect(rejoinOpacity(0.06)).toBeLessThan(1);
  });
});
