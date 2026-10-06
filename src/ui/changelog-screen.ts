// The DOM for ui-3 (docs/milestones/M2.md): the "what's new since you last played" card, which
// sits beside the menu so the Race button stays in reach, and the changelog page, with the player
// notes first and the developer notes behind a button (docs/engineering.md, "What-changed notes").
import { cardLines, changelogDays, type ChangelogNote, type WhatsNew } from './whats-new';

export const CHANGELOG_CSS = `
#menu.with-news { flex-direction: row; gap: 28px; }
#menu .menu-main { display: flex; flex-direction: column; align-items: center; gap: 10px; }
#whats-new { flex: 0 0 auto; width: min(320px, 38vw); display: flex; flex-direction: column; gap: 6px; }
/* Beside the menu (a screen taller than 380 px, or upright): the menu takes the room the card leaves, not
   more, so the card never stands over the region and road chips or off the screen's side (playtest 4,
   run B, punch item 10: on a first visit it covered chips 3 and 4). The chips stay inside that room, and
   the road row scrolls there. The short landscape layout stacks the card under the menu instead. */
@media (min-height: 381px), (orientation: portrait) {
  #menu.with-news .menu-main { flex: 1 1 0; min-width: 0; max-width: 600px; }
  #menu.with-news #region-picker, #menu.with-news #route-picker { max-width: 100%; }
}
#whats-new .wn-title { font: 800 0.9375rem ui-monospace, monospace; color: #f5c542; }
#whats-new ul { margin: 0; padding-left: 18px; display: grid; gap: 4px; }
#whats-new .row { justify-content: flex-start; gap: 8px; }
#changelog { justify-content: flex-start; padding-top: 8px; padding-bottom: 34px; gap: 8px; }
#changelog .settings-bar { display: flex; gap: 6px; justify-content: center; }
#changelog-list { width: min(680px, 94vw); flex: 1 1 auto; min-height: 0; overflow-y: auto; text-align: left;
  pointer-events: auto; touch-action: pan-y; background: #000a; padding: 6px 12px; box-sizing: border-box;
  font: 500 0.875rem/1.4 system-ui, sans-serif; }
#changelog-list h3 { margin: 8px 0 4px; font: 800 0.8125rem ui-monospace, monospace; color: #f5c542; }
#changelog-list p { margin: 0 0 8px; }
#changelog-list .cl-kind { font: 800 0.6875rem ui-monospace, monospace; text-transform: uppercase; margin-right: 6px;
  color: #f2ead8; opacity: 0.8; }
`;

function node<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> = {},
  ...kids: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const n: HTMLElementTagNameMap[K] = document.createElement(tag);
  Object.assign(n, props);
  n.append(...kids);
  return n;
}

function smallButton(id: string, text: string, onClick: () => void): HTMLButtonElement {
  const b = node('button', { id, className: 'small', type: 'button', textContent: text });
  b.addEventListener('click', onClick);
  return b;
}

const WELCOME =
  'Race the coast, fight the field, outrun the law. The game changes often; next time, this card says what is new.';

export interface WhatsNewCard {
  readonly root: HTMLElement;
  /** Fills and shows the card; `none` hides it. */
  show(w: WhatsNew): void;
  hide(): void;
}

export function createWhatsNewCard(opts: { onOpenChangelog(): void; onHide(): void }): WhatsNewCard {
  const title = node('div', { className: 'wn-title' });
  const list = node('ul');
  const root = node('div', { id: 'whats-new', className: 'card', hidden: true });
  const hide = () => {
    root.hidden = true;
    opts.onHide();
  };
  root.append(
    title,
    list,
    node(
      'div',
      { className: 'row' },
      smallButton('whats-new-ok', 'Got it', hide),
      smallButton('whats-new-all', 'All changes', () => opts.onOpenChangelog()),
    ),
  );
  return {
    root,
    show(w) {
      if (w.kind === 'none') return hide();
      title.textContent = w.kind === 'welcome' ? 'Welcome' : 'New since you last played';
      const lines = w.kind === 'welcome' ? [WELCOME] : cardLines(w.notes);
      list.replaceChildren(...lines.map((text) => node('li', { textContent: text })));
      root.hidden = false;
    },
    hide,
  };
}

export interface ChangelogScreen {
  readonly root: HTMLElement;
  /** The notes to list (null while loading or when the file is missing). */
  setNotes(notes: readonly ChangelogNote[] | null): void;
}

export function createChangelogScreen(opts: { onBack(): void }): ChangelogScreen {
  // undefined while loading; null when the file could not be loaded.
  let notes: readonly ChangelogNote[] | null | undefined = undefined;
  let audience: 'player' | 'dev' = 'player';
  const list = node('div', { id: 'changelog-list' });
  const devButton = smallButton('changelog-dev', 'Developer notes', () => {
    audience = audience === 'player' ? 'dev' : 'player';
    render();
  });
  const root = node(
    'div',
    { id: 'changelog', className: 'screen', hidden: true },
    node(
      'div',
      { className: 'settings-bar' },
      smallButton('changelog-back', 'Back', () => opts.onBack()),
      devButton,
    ),
    list,
  );
  function render() {
    devButton.textContent = audience === 'player' ? 'Developer notes' : 'Player notes';
    if (notes === undefined) {
      list.replaceChildren(node('p', { textContent: 'Loading the list of changes…' }));
      return;
    }
    if (notes === null) {
      list.replaceChildren(node('p', { textContent: 'The list of changes could not be loaded.' }));
      return;
    }
    const days = changelogDays(notes, audience);
    if (days.length === 0) {
      list.replaceChildren(node('p', { textContent: 'Nothing here yet.' }));
      return;
    }
    list.replaceChildren(
      ...days.flatMap((d) => [
        node('h3', { textContent: d.day }),
        ...d.notes.map((n) =>
          node('p', {}, node('span', { className: 'cl-kind', textContent: n.kind }), n.text),
        ),
      ]),
    );
    list.scrollTop = 0;
  }
  render();
  return {
    root,
    setNotes(next) {
      notes = next;
      render();
    },
  };
}
