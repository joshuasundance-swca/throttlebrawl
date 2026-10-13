// The reload-recovery card contract. UI reports one choice synchronously; APP owns recovery.
export type ResumeCardKind = 'riding' | 'pending-result' | 'save-failed' | 'unavailable' | 'retry-load';
export type ResumeCardChoice = 'resume' | 'startOver';

export interface ResumeCardView {
  title: string;
  explanation: string;
  primary: string | null;
  abandon: string;
}

export interface ResumeChoiceController {
  offer(onChoice: (choice: ResumeCardChoice) => void, kind?: ResumeCardKind, detail?: string): ResumeCardView;
  choose(choice: ResumeCardChoice): boolean;
}

const VIEWS: Readonly<Record<ResumeCardKind, Readonly<ResumeCardView>>> = {
  riding: {
    title: 'Race in progress',
    explanation: 'You left mid-race. Pick up where you were?',
    primary: 'Resume race',
    abandon: 'Start over',
  },
  'pending-result': {
    title: 'Result waiting',
    explanation: 'Your race finished. Recover its result, or discard it without saving.',
    primary: 'Recover results',
    abandon: 'Discard result',
  },
  'save-failed': {
    title: 'Result not saved',
    explanation: 'Retry saving this result, or abandon it without saving.',
    primary: 'Retry saving result',
    abandon: 'Abandon result',
  },
  unavailable: {
    title: 'Saved race unavailable',
    explanation: 'This saved race cannot resume. Start over to discard it.',
    primary: null,
    abandon: 'Start over',
  },
  'retry-load': {
    title: 'Saved race not loaded',
    explanation: 'Retry loading your saved race, or start over to discard it.',
    primary: 'Retry',
    abandon: 'Start over',
  },
};

export function createResumeChoiceController(hide: () => void): ResumeChoiceController {
  let callback: ((choice: ResumeCardChoice) => void) | null = null;
  let primaryAllowed = false;
  return {
    offer(onChoice, kind = 'riding', detail) {
      callback = onChoice;
      const view = VIEWS[kind];
      primaryAllowed = view.primary !== null;
      return {
        ...view,
        explanation: detail ? `${view.explanation} ${detail}` : view.explanation,
      };
    },
    choose(choice) {
      const current = callback;
      if (!current || (choice === 'resume' && !primaryAllowed)) return false;
      callback = null;
      primaryAllowed = false;
      hide();
      current(choice);
      return true;
    },
  };
}
