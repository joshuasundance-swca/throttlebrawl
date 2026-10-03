import { describe, expect, it } from 'vitest';
import type { PaperView, PosterView, RivalText } from '../career';
import { findAll, gigNode, paperNode, posterNode, SHOW_CSS, textOf, textsNode } from './career-show';

// The career show as drawn (run W-S, career-show lane): the rendered trees ui/ turns into elements,
// read without a browser. tests/e2e/career.spec.ts checks the same pieces on the real page in CI.

const poster: PosterView = {
  live: 'LIVE · GOLDEN HOUR',
  faces: [
    {
      id: 'base:deacon-vane',
      name: 'Deacon Vane',
      initials: 'DV',
      colours: ['#1b1b1f', '#f2ead8'],
      beef: '7 sins.',
      grudge: 7,
    },
    {
      id: 'base:dial-up',
      name: 'Dial-Up',
      initials: 'DI',
      colours: ['#d9d2b6', '#111111'],
      beef: 'Connected at 56k.',
      grudge: 0,
    },
  ],
  rule: null,
};

const paper = (style: PaperView['style']): PaperView => ({
  name: 'The Mile Marker Shriek',
  style,
  tagline: 'Printed between hurricanes',
  dateline: 'GOLDEN HOUR EDITION · RACE 4',
  headline: 'KEVIN FROM ACCOUNTING KNOCKED INTO MANGROVES',
  deck: 'The Shakedown: won, 1st of 5.',
  caption: 'Pictured: Kevin from Accounting, shortly before.',
  moment: 'down',
});

const text: RivalText = {
  id: 'base:kevin-from-accounting',
  from: 'Kevin from Accounting',
  colour: '#e9e4d4',
  memory: 'After The Shakedown: you knocked them off twice.',
  line: 'Circling back. Grudge level 8.',
  grudge: 8,
};

describe('the career show, drawn', () => {
  it('the poster: the chyron, a coloured badge and a beef line per face, a hot grudge marked', () => {
    const tree = posterNode(poster);
    expect(textOf(tree)).toContain('LIVE · GOLDEN HOUR');
    const faces = findAll(tree, 'show-face');
    expect(faces).toHaveLength(2);
    expect(faces[0]?.cls).toContain('hot');
    expect(faces[1]?.cls).not.toContain('hot');
    expect(textOf(faces[0] as never)).toBe('DV Deacon Vane · grudge 7/10 7 sins.');
    expect(textOf(faces[1] as never)).toBe('DI Dial-Up Connected at 56k.');
    expect(findAll(tree, 'show-badge')[0]?.style).toEqual({ background: '#1b1b1f', color: '#f2ead8' });
    expect(findAll(tree, 'show-rule')).toHaveLength(0);
  });

  it("the poster states a grudge match's rule (run W-T): its name and its one line", () => {
    const tree = posterNode({
      ...poster,
      rule: { id: 'bad-connection', name: 'BAD CONNECTION', line: 'Hit him while he buffers.' },
    });
    const rule = findAll(tree, 'show-rule');
    expect(rule).toHaveLength(1);
    expect(rule[0]?.attrs).toEqual({ 'data-rule': 'bad-connection' });
    expect(textOf(rule[0] as never)).toBe('RULES: BAD CONNECTION Hit him while he buffers.');
    expect(SHOW_CSS).toContain('.show-rule {');
  });

  it('the paper: one id, styled per region, headline, still caption and the result', () => {
    for (const style of ['rag', 'newsletter', 'blog'] as const) {
      const tree = paperNode(paper(style));
      expect(tree).toMatchObject({ id: 'career-paper', cls: `show-paper paper-${style}` });
      expect(SHOW_CSS, `${style} has its own look`).toContain(`.paper-${style} {`);
    }
    const tree = paperNode(paper('rag'));
    expect(findAll(tree, 'paper-headline')[0]?.text).toBe('KEVIN FROM ACCOUNTING KNOCKED INTO MANGROVES');
    expect(findAll(tree, 'paper-date')[0]?.text).toBe(
      'Printed between hurricanes · GOLDEN HOUR EDITION · RACE 4',
    );
    expect(textOf(tree)).toContain('Pictured: Kevin from Accounting, shortly before.');
    expect(textOf(tree)).toContain('The Shakedown: won, 1st of 5.');
  });

  it('the texts: none drawn when nobody wrote; otherwise the count, sender, line and memory', () => {
    expect(textsNode([])).toBeNull();
    const tree = textsNode([text, { ...text, id: 'x', from: 'Dial-Up', grudge: 0 }]);
    if (!tree) throw new Error('no texts');
    expect(findAll(tree, 'texts-head')[0]?.text).toBe('2 NEW MESSAGES');
    const first = findAll(tree, 'show-text')[0];
    expect(textOf(first as never)).toBe(
      'Kevin from Accounting grudge 8/10 Circling back. Grudge level 8. After The Shakedown: you knocked them off twice.',
    );
    expect(textOf(findAll(tree, 'show-text')[1] as never)).not.toContain('grudge');
    expect(findAll(tree, 'text-dot')[0]?.style).toEqual({ background: '#e9e4d4' });
  });

  it('the side gig: what it is, what it pays and what it needs, in plain words', () => {
    const tree = gigNode({
      name: 'Pie run',
      need: 'Finish in the top 3',
      text: 'Upright.',
      cash: 250,
      regionName: 'The Florida Keys',
    });
    expect(tree.id).toBe('career-gig');
    expect(textOf(tree)).toBe(
      'SIDE GIG Pie run · pays $250 Upright. Finish in the top 3, in your next career race in The Florida Keys.',
    );
  });

  it('no badge clips its initials (the phone overflow check reads every text box)', () => {
    // A 34 px badge with a 2 px border holds 30 px of line.
    expect(SHOW_CSS).toMatch(/width: 34px; height: 34px; line-height: 30px;[^}]*border: 2px solid/);
  });
});
