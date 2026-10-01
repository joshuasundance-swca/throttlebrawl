// The base pack's bark lines against the tone guide's writing rules and narrative-1's scope
// (docs/tone-guide.md, "The bark system"; docs/milestones/M1.md, narrative-1). content-1's
// packs:check owns the pack-wide warning over 80 characters and the banned-name check; these
// tests hold this lane's own files to the same bar, and to a few rules only barks have.
import { describe, expect, it } from 'vitest';
import { basePackFiles, loadBasePack } from '../../content';
import { conditionsFrom, isMemoryFact } from './conditions';
import { barkLinesFrom, bubbleDurationS, M1_TRIGGERS, M2_TRIGGERS, V1_TRIGGERS } from './selector';

interface RawLine {
  id: string;
  trigger: string;
  text: string;
  status?: string;
  when?: unknown;
}
interface RawSet {
  id: string;
  defaults?: { speaker?: string };
  lines: RawLine[];
}

const files = basePackFiles().filter((f) => f.path.startsWith('barks/'));
const sets = files.map((f) => f.json as RawSet);
const allLines = sets.flatMap((s) => s.lines);

// The racing rivals: the four regulars, then the three Florida locals (M4 rivals-1's head start).
const RIVALS = [
  'deacon-vane',
  'dial-up',
  'chad-speedwell',
  'kevin-from-accounting',
  'tammy-two-stroke',
  'the-mayor',
  'mother-rust',
];
// The named cop speaks too, on the cop's own triggers (the siren and the bust), not the racers'.
const COP = 'sgt-pruitt';
const SPEAKERS = [...RIVALS, COP];
// Each speaker's approved line (docs/tone-guide.md, "The rivals"), verbatim.
const APPROVED: Record<string, string> = {
  'deacon-vane': 'Pray the ditch is soft, sinner.',
  'dial-up': "You've got mail. It's my boot.",
  'chad-speedwell': "Smash that subscri— oh. You're smashed.",
  'kevin-from-accounting': 'Per my last email: move.',
  'tammy-two-stroke': "Honey, I've passed hearses faster than you.",
  'the-mayor': 'Vote early. Crash often.',
  'mother-rust': "I've eaten tires tougher than you.",
  [COP]: 'License, registration, and your front teeth.',
};
const APPROVED_TEXT = new Set(Object.values(APPROVED));

describe('base pack bark sets', () => {
  it('exist, one file per speaker, and load through the registry', () => {
    expect(files.length).toBe(SPEAKERS.length);
    expect(sets.map((s) => s.defaults?.speaker).sort()).toEqual([...SPEAKERS].sort());
    const reg = loadBasePack();
    expect(Object.keys(reg.barkSets).sort()).toEqual(sets.map((s) => `base:${s.id}`).sort());
    expect(barkLinesFrom(reg.barkSets).length).toBe(allLines.length);
  });

  it('give each rival race-start, overtake and hit-landed lines, and every speaker the approved one', () => {
    for (const rival of RIVALS) {
      const mine = sets.filter((s) => s.defaults?.speaker === rival).flatMap((s) => s.lines);
      for (const trigger of M1_TRIGGERS) {
        expect(mine.filter((l) => l.trigger === trigger).length, `${rival} ${trigger}`).toBeGreaterThan(0);
      }
    }
    for (const speaker of SPEAKERS) {
      const mine = sets.filter((s) => s.defaults?.speaker === speaker).flatMap((s) => s.lines);
      expect(
        mine.map((l) => l.text),
        speaker,
      ).toContain(APPROVED[speaker]);
    }
  });

  it("give the cop plain lines for the siren and the bust (the cop's own triggers)", () => {
    const mine = sets.filter((s) => s.defaults?.speaker === COP).flatMap((s) => s.lines);
    for (const trigger of ['cop-siren', 'busted']) {
      expect(mine.filter((l) => l.trigger === trigger && !l.when).length, trigger).toBeGreaterThanOrEqual(2);
    }
  });

  it('give each rival at least two lines for every M2 trigger (docs/milestones/M2.md, narrative-2)', () => {
    for (const rival of RIVALS) {
      const mine = sets.filter((s) => s.defaults?.speaker === rival).flatMap((s) => s.lines);
      for (const trigger of M2_TRIGGERS) {
        const plain = mine.filter((l) => l.trigger === trigger && !l.when);
        expect(plain.length, `${rival} ${trigger}`).toBeGreaterThanOrEqual(2);
      }
    }
  });

  it('read every when condition, and give every memory line a plain sibling (tone guide rule 6)', () => {
    for (const s of sets) {
      for (const l of s.lines) {
        if (l.when === undefined) continue;
        const conds = conditionsFrom(l.when);
        expect(conds, l.id).not.toBeNull();
        if (!conds?.some((c) => isMemoryFact(c.fact))) continue;
        const siblings = s.lines.filter((x) => x.trigger === l.trigger && x.when === undefined);
        expect(siblings.length, `${l.id} needs a plain ${l.trigger} sibling`).toBeGreaterThan(0);
      }
    }
    expect(allLines.filter((l) => l.when !== undefined).length).toBeGreaterThan(0);
  });

  it('give every line a content id, unique within its set and across the pack', () => {
    for (const s of sets) {
      const ids = s.lines.map((l) => l.id);
      expect(new Set(ids).size, s.id).toBe(ids.length);
      for (const id of ids) expect(id).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    }
    const every = allLines.map((l) => l.id);
    expect(new Set(every).size).toBe(every.length);
  });

  it('use only v1 triggers, and are short, calm and emoji-free', () => {
    for (const l of allLines) {
      expect(V1_TRIGGERS, l.id).toContain(l.trigger);
      const chars = [...l.text].length;
      expect(chars, l.id).toBeLessThanOrEqual(80);
      // The writing target is 42 characters, a bubble of at most 2.8 s at 15 characters a second.
      // The tone guide caps lines at 80 and only aims for 42, and an approved line stays verbatim,
      // so the two approved lines past 42 (Tammy's at 43, Pruitt's at 44) keep their length.
      if (!APPROVED_TEXT.has(l.text)) {
        expect(chars, l.id).toBeLessThanOrEqual(42);
        expect(bubbleDurationS(l.text), l.id).toBeLessThanOrEqual(2.8 + 1e-9);
      }
      expect((l.text.match(/!/g) ?? []).length, l.id).toBeLessThanOrEqual(1);
      expect(l.text, l.id).not.toMatch(/\p{Extended_Pictographic}/u);
      expect(l.text.trim(), l.id).toBe(l.text);
    }
  });

  it('never use the banned name, and never repeat a line', () => {
    for (const f of files) expect(JSON.stringify(f.json), f.path).not.toMatch(/road\s*-?\s*rash/i);
    const norm = allLines.map((l) =>
      l.text
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .trim(),
    );
    expect(new Set(norm).size).toBe(norm.length);
  });
});
