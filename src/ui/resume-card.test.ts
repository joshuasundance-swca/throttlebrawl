import { describe, expect, it } from 'vitest';
import { createResumeChoiceController, type ResumeCardChoice } from './resume-card';

describe('race recovery card contract', () => {
  it('keeps the default unfinished-race offer', () => {
    const card = createResumeChoiceController(() => undefined);
    expect(card.offer(() => undefined)).toEqual({
      title: 'Race in progress',
      explanation: 'You left mid-race. Pick up where you were?',
      primary: 'Resume race',
      abandon: 'Start over',
    });
  });

  it.each([
    ['pending-result', 'Recover results', 'Discard result'],
    ['save-failed', 'Retry saving result', 'Abandon result'],
  ] as const)('describes %s as a result with an explicit abandon action', (kind, primary, abandon) => {
    const card = createResumeChoiceController(() => undefined);
    const view = card.offer(() => undefined, kind);
    expect(view.primary).toBe(primary);
    expect(view.abandon).toBe(abandon);
    expect(view.title.toLowerCase()).toContain('result');
    expect(view.explanation.toLowerCase()).toContain('result');
    expect(view.explanation.toLowerCase()).toMatch(/discard|abandon/);
    expect(view.explanation).not.toContain('mid-race');
  });

  it('retains a retryable failure explanation with Retry', () => {
    const card = createResumeChoiceController(() => undefined);
    const view = card.offer(() => undefined, 'retry-load', 'The race roads did not load.');
    expect(view.primary).toBe('Retry');
    expect(view.explanation).toContain('The race roads did not load.');
    expect(view.abandon).toBe('Start over');
  });

  it('does not hide or report resume for an unavailable recording', () => {
    const events: string[] = [];
    const card = createResumeChoiceController(() => events.push('hide'));
    const view = card.offer(
      (choice) => events.push(choice),
      'unavailable',
      'The saved race is incompatible.',
    );
    expect(view.primary).toBeNull();
    expect(view.explanation).toContain('The saved race is incompatible.');
    expect(card.choose('resume')).toBe(false);
    expect(events).toEqual([]);
    expect(card.choose('startOver')).toBe(true);
    expect(events).toEqual(['hide', 'startOver']);
  });

  it.each(['resume', 'startOver'] as const)('hides before reporting %s synchronously and once', (choice) => {
    const events: string[] = [];
    const card = createResumeChoiceController(() => events.push('hide'));
    card.offer((selected) => events.push(selected));
    events.push('before');
    expect(card.choose(choice)).toBe(true);
    events.push('after');
    expect(card.choose(choice)).toBe(false);
    expect(events).toEqual(['before', 'hide', choice, 'after']);
  });

  it('retires a previous callback and its resume action when replaced by an unavailable offer', () => {
    const first: ResumeCardChoice[] = [];
    const second: ResumeCardChoice[] = [];
    const card = createResumeChoiceController(() => undefined);
    card.offer((choice) => first.push(choice));
    card.offer((choice) => second.push(choice), 'unavailable');
    expect(card.choose('resume')).toBe(false);
    expect(card.choose('startOver')).toBe(true);
    expect(first).toEqual([]);
    expect(second).toEqual(['startOver']);
  });
});
