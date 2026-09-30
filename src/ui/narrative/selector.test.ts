import { describe, expect, it } from 'vitest';
import {
  BARK_TUNING,
  barkLinesFrom,
  barkParamDefaults,
  bubbleDurationS,
  createBarkSelector,
  type BarkLine,
  type BarkRequest,
} from './selector';

const DEACON = 'base:deacon-vane';
const KEVIN = 'base:kevin-from-accounting';

function set(id: string, speaker: string, lines: Record<string, unknown>[], defaults = {}) {
  return {
    type: 'bark-set',
    id,
    defaults: { speaker, cooldownS: 0, weight: 1, ...defaults },
    lines,
  };
}

function linesFor(speaker: string, n: number, trigger = 'overtake'): Record<string, unknown>[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `${speaker}-line-${i}`,
    trigger,
    text: `Line ${i} from ${speaker}.`,
  }));
}

function lines(...sets: ReturnType<typeof set>[]): BarkLine[] {
  const table: Record<string, unknown> = {};
  for (const s of sets) table[`base:${s.id}`] = s;
  return barkLinesFrom(table);
}

const req = (speakers: string[], nowS: number, trigger = 'overtake'): BarkRequest => ({
  trigger,
  speakers,
  target: { contentRef: 'base:player', isPlayer: true },
  nowS,
});

describe('bubble time', () => {
  it('shows a 42-character line for 2.8 s', () => {
    const text = 'Every road leads somewhere. Yours ends her';
    expect([...text].length).toBe(42);
    expect(bubbleDurationS(text)).toBeCloseTo(2.8, 10);
  });

  it('never shows a line for less than 2 s', () => {
    expect(bubbleDurationS('No.')).toBe(2);
  });

  it('counts characters, not UTF-16 units or bytes', () => {
    // 45 ellipsis characters are 45 characters (not 45 UTF-8 triples): 45 ÷ 15 = 3 s.
    expect(bubbleDurationS('…'.repeat(45))).toBeCloseTo(3, 10);
  });

  it('declares every tuning default inside its range, on the barks group, presentation-only', () => {
    for (const d of BARK_TUNING) {
      expect(d.id.startsWith('barks.')).toBe(true);
      expect(d.default).toBeGreaterThanOrEqual(d.min);
      expect(d.default).toBeLessThanOrEqual(d.max);
      expect(d.affectsSim).toBe(false);
    }
    expect(barkParamDefaults()).toEqual({
      minGapPerSpeakerS: 6,
      minGapGlobalS: 0.5,
      ringSize: 12,
      minBubbleS: 2,
      charsPerS: 15,
    });
  });
});

describe('barkLinesFrom', () => {
  it('qualifies speakers, applies set defaults and builds content refs', () => {
    const out = lines(
      set('kevin-core', 'kevin-from-accounting', [
        { id: 'kevin-pass-email', trigger: 'overtake', text: 'Per my last email: move.' },
        { id: 'kevin-any', trigger: 'overtake', text: 'x', speaker: 'any', weight: 3, cooldownS: 5 },
      ]),
    );
    expect(out.map((l) => l.ref)).toEqual([
      'base:bark-set/kevin-core#kevin-any',
      'base:bark-set/kevin-core#kevin-pass-email',
    ]);
    const email = out.find((l) => l.id === 'kevin-pass-email');
    expect(email).toMatchObject({ speaker: KEVIN, target: 'any', weight: 1, cooldownS: 0, chance: 1 });
    expect(out.find((l) => l.id === 'kevin-any')).toMatchObject({ speaker: 'any', weight: 3, cooldownS: 5 });
  });

  it('skips vetoed lines, and draft lines unless asked', () => {
    const s = set('deacon-core', 'deacon-vane', [
      { id: 'a', trigger: 'overtake', text: 'a' },
      { id: 'b', trigger: 'overtake', text: 'b', status: 'vetoed' },
      { id: 'c', trigger: 'overtake', text: 'c', status: 'draft' },
    ]);
    expect(barkLinesFrom({ 'base:deacon-core': s }).map((l) => l.id)).toEqual(['a']);
    expect(barkLinesFrom({ 'base:deacon-core': s }, { includeDrafts: true }).map((l) => l.id)).toEqual([
      'a',
      'c',
    ]);
  });
});

describe('selector', () => {
  it('picks a line whose trigger, speaker and target match', () => {
    const sel = createBarkSelector(
      lines(
        set('deacon-core', 'deacon-vane', [
          { id: 'start', trigger: 'race-start', text: 'Pray the ditch is soft, sinner.' },
          { id: 'pass-rival', trigger: 'overtake', text: 'Rivals only.', target: KEVIN },
          { id: 'pass-player', trigger: 'overtake', text: 'Player only.', target: 'player' },
        ]),
        set('kevin-core', 'kevin-from-accounting', linesFor('kevin', 1)),
      ),
    );
    const start = sel.request(req([DEACON], 0, 'race-start'));
    expect(start?.line.id).toBe('start');
    expect(start?.speaker).toBe(DEACON);
    const pass = sel.request(req([DEACON], 10));
    expect(pass?.line.id).toBe('pass-player');
    const passKevin = sel.request({
      trigger: 'overtake',
      speakers: [DEACON],
      target: { contentRef: KEVIN, isPlayer: false },
      nowS: 20,
    });
    expect(passKevin?.line.id).toBe('pass-rival');
    // Nobody has lines for this trigger: silence.
    expect(sel.request(req([DEACON, KEVIN], 30, 'hit-landed'))).toBeNull();
  });

  it('never repeats a line while it is in the speaker ring, and goes silent rather than repeat', () => {
    const ringSize = 5;
    const sel = createBarkSelector(lines(set('deacon-core', 'deacon-vane', linesFor('deacon', 8))), {
      ...barkParamDefaults(),
      ringSize,
    });
    sel.reset(7);
    const heard: string[] = [];
    let silent = 0;
    for (let i = 0; i < 400; i++) {
      const bark = sel.request(req([DEACON], i * 10));
      if (!bark) {
        silent++;
        continue;
      }
      expect(heard.slice(-ringSize)).not.toContain(bark.line.id);
      heard.push(bark.line.id);
    }
    expect(heard.length).toBe(400);
    expect(silent).toBe(0);
    // Every line gets heard: 8 lines, ring 5, so 3 are eligible at any moment.
    expect(new Set(heard).size).toBe(8);

    // A ring as big as the pool: after every line has been said once, the speaker goes quiet.
    const full = createBarkSelector(lines(set('deacon-core', 'deacon-vane', linesFor('deacon', 3))));
    const said = [0, 10, 20, 30, 40].map((t) => full.request(req([DEACON], t))?.line.id ?? null);
    expect(new Set(said.slice(0, 3)).size).toBe(3);
    expect(said.slice(3)).toEqual([null, null]);
  });

  it('holds each line to its own cooldown', () => {
    const sel = createBarkSelector(
      lines(set('deacon-core', 'deacon-vane', linesFor('deacon', 1), { cooldownS: 90 })),
      { ...barkParamDefaults(), ringSize: 0 },
    );
    expect(sel.request(req([DEACON], 0))).not.toBeNull();
    expect(sel.request(req([DEACON], 89.9))).toBeNull();
    expect(sel.request(req([DEACON], 90))).not.toBeNull();
  });

  it('holds the gaps per speaker and across all speakers, with one bubble at a time', () => {
    const params = barkParamDefaults();
    const speakers = [DEACON, KEVIN, 'base:dial-up', 'base:chad-speedwell'];
    const sel = createBarkSelector(
      lines(
        set('deacon-core', 'deacon-vane', linesFor('deacon', 30)),
        set('kevin-core', 'kevin-from-accounting', linesFor('kevin', 30)),
        set('dial-up-core', 'dial-up', linesFor('dial-up', 30)),
        set('chad-core', 'chad-speedwell', linesFor('chad', 30)),
      ),
      { ...params, ringSize: 0 },
    );
    sel.reset(42);
    // A storm of requests: every 0.1 s, one random speaker (fixed pseudo-random order).
    let x = 12345;
    const shown: { speaker: string; startS: number; endS: number }[] = [];
    for (let i = 0; i < 3000; i++) {
      x = (x * 1103515245 + 12345) % 2147483648;
      const speaker = speakers[x % speakers.length] ?? DEACON;
      const bark = sel.request(req([speaker], i * 0.1));
      if (bark)
        shown.push({ speaker: bark.speaker, startS: bark.startS, endS: bark.startS + bark.durationS });
    }
    expect(shown.length).toBeGreaterThan(50);
    for (let i = 1; i < shown.length; i++) {
      const prev = shown[i - 1];
      const cur = shown[i];
      if (!prev || !cur) throw new Error('unreachable');
      // One bubble at a time, then the global quiet gap.
      expect(cur.startS).toBeGreaterThanOrEqual(prev.endS + params.minGapGlobalS - 1e-9);
    }
    const lastBy = new Map<string, number>();
    for (const s of shown) {
      const last = lastBy.get(s.speaker);
      if (last !== undefined) expect(s.startS - last).toBeGreaterThanOrEqual(params.minGapPerSpeakerS - 1e-9);
      lastBy.set(s.speaker, s.startS);
    }
  });

  it('picks by weight on a seeded presentation stream, reproducibly', () => {
    const pool = lines(
      set('deacon-core', 'deacon-vane', [
        { id: 'heavy', trigger: 'overtake', text: 'Heavy.', weight: 9 },
        { id: 'light', trigger: 'overtake', text: 'Light.', weight: 1 },
      ]),
    );
    const run = (seed: number) => {
      const sel = createBarkSelector(pool, { ...barkParamDefaults(), ringSize: 0 });
      const out: string[] = [];
      for (let i = 0; i < 2000; i++) {
        sel.reset(seed + i);
        out.push(sel.request(req([DEACON], 0))?.line.id ?? '-');
      }
      return out;
    };
    const a = run(1);
    expect(run(1)).toEqual(a);
    const heavy = a.filter((id) => id === 'heavy').length / a.length;
    expect(heavy).toBeGreaterThan(0.85);
    expect(heavy).toBeLessThan(0.95);
  });

  it('rolls chance after the pick and stays silent on a miss', () => {
    const sel = createBarkSelector(
      lines(set('deacon-core', 'deacon-vane', [{ id: 'never', trigger: 'overtake', text: 'x', chance: 0 }])),
    );
    expect(sel.request(req([DEACON], 0))).toBeNull();
  });

  it('starts clean on reset', () => {
    const sel = createBarkSelector(lines(set('deacon-core', 'deacon-vane', linesFor('deacon', 1))));
    expect(sel.request(req([DEACON], 0))).not.toBeNull();
    expect(sel.request(req([DEACON], 10))).toBeNull();
    sel.reset(1);
    expect(sel.request(req([DEACON], 0))).not.toBeNull();
  });

  it('applies tuning changes by id', () => {
    const sel = createBarkSelector(lines(set('deacon-core', 'deacon-vane', linesFor('deacon', 5))));
    sel.setParam('barks.minGapPerSpeakerS', 20);
    expect(sel.request(req([DEACON], 0))).not.toBeNull();
    expect(sel.request(req([DEACON], 19))).toBeNull();
    expect(sel.request(req([DEACON], 20))).not.toBeNull();
    expect(() => sel.setParam('barks.nope', 1)).toThrow();
  });
});
