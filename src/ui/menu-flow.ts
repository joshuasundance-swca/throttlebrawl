import type { MakeButton } from './race-options-view';

interface MenuControls {
  career: HTMLElement | null;
  settings: HTMLElement;
  region: HTMLElement;
  route: HTMLElement;
  race: HTMLElement;
  options: HTMLElement | null;
  secondary: HTMLElement[];
  onChange(): void;
}

export function createMenuFlow(make: MakeButton, controls: MenuControls) {
  const home = document.createElement('div');
  const quick = document.createElement('div');
  const details = document.createElement('div');
  const actions = document.createElement('div');
  home.id = 'menu-home';
  home.className = 'menu-home';
  quick.id = 'quick-play';
  quick.className = 'quick-play';
  quick.hidden = true;
  details.id = 'quick-play-details';
  details.className = 'flow-details';
  actions.id = 'quick-play-actions';
  actions.className = 'flow-actions';
  let isQuick = false;
  const enter = make('menu-quick-play', 'big', 'Quick Play', () => open());
  const backButton = make('quick-play-back', 'small', 'Menu', () => back());
  function open(focus = true) {
    isQuick = true;
    home.hidden = true;
    quick.hidden = false;
    controls.onChange();
    if (focus) backButton.focus();
  }
  function back() {
    isQuick = false;
    home.hidden = false;
    quick.hidden = true;
    controls.onChange();
    enter.focus();
  }
  const more = document.createElement('details');
  more.id = 'menu-more';
  const summary = document.createElement('summary');
  summary.textContent = 'More';
  const tools = document.createElement('div');
  tools.className = 'menu-tools';
  tools.append(...controls.secondary);
  more.append(summary, tools);
  home.append(...(controls.career ? [controls.career] : []), enter, controls.settings, more);
  const head = document.createElement('div');
  head.className = 'flow-heading';
  head.textContent = 'Quick Play';
  details.append(controls.region, controls.route);
  actions.append(backButton, ...(controls.options ? [controls.options] : []), controls.race);
  quick.append(head, details, actions);
  return {
    home,
    quick,
    details,
    actions,
    get isQuick() {
      return isQuick;
    },
    open,
    back,
  };
}

// The screen gives its details the remaining space; primary actions never join that scroll.
export const MENU_FLOW_CSS = `
#ui #menu { padding-top: max(10px, env(safe-area-inset-top)); }
#ui #menu .menu-main { display: flex; flex-direction: column; gap: 14px; width: min(680px, 100%); min-width: 0; }
#ui #menu-home { display: grid; gap: 10px; width: min(420px, 100%); align-self: center; }
#ui #menu-home > button { width: 100%; }
#ui #menu-more { color: #f2ead8; pointer-events: auto; }
#ui #menu-more summary { cursor: pointer; min-height: 44px; display: flex; align-items: center; justify-content: center;
  font: 800 0.875rem ui-monospace, monospace; }
#ui .menu-tools { display: flex; flex-wrap: wrap; gap: 8px; justify-content: center; padding: 4px; }
#ui #quick-play { display: flex; flex-direction: column; gap: 12px; min-height: 0; width: 100%; }
#ui .flow-heading { font: 900 1.125rem ui-monospace, monospace; color: #f5c542; }
#ui .flow-actions { display: flex; flex-wrap: wrap; gap: 8px; justify-content: center; flex: 0 0 auto; padding: 4px; }
#ui .flow-details { min-height: 0; overflow-y: auto; overscroll-behavior: contain; touch-action: pan-y;
  display: flex; flex-direction: column; gap: 12px; align-items: center; padding: 4px; box-sizing: border-box; pointer-events: auto; }
#ui #menu.quick-setup { justify-content: flex-start; overflow: hidden; padding-bottom: max(10px, env(safe-area-inset-bottom)); }
#ui #menu.quick-setup .menu-main { flex: 1 1 auto; min-height: 0; }
#ui #menu.quick-setup #quick-play { flex: 1 1 auto; }
#ui #quick-play-details { flex: 1 1 auto; }
#ui #menu.quick-setup .footer, #ui #menu.quick-setup #whats-new { display: none; }
#ui #menu.quick-setup .menu-build-line { display: block; }
#ui #menu :is(.small, .big) { min-height: 44px; }
#ui #menu .title { align-self: center; max-width: 100%; box-sizing: border-box; overflow-wrap: anywhere; }
/* The welcome card follows the primary actions in a portrait window, rather than taking half
   their width. Keep enlarged text at its chosen size and let the screen scroll when needed. */
@media (orientation: portrait) {
  #ui #menu.with-news { flex-direction: column; gap: 14px; }
  #ui #menu.with-news .menu-main { flex: 0 0 auto; width: 100%; max-width: 680px; }
  #ui #menu.with-news #whats-new { width: min(560px, 100%); }
}
@media (orientation: landscape) and (max-height: 440px) {
  #ui #menu .menu-main { gap: 6px; }
  #ui #menu-home { grid-template-columns: repeat(3, minmax(0, 1fr)); width: 100%; }
  #ui #menu-home > button { padding: 6px 8px; font-size: 1rem; }
  #ui #menu-more { grid-column: 1 / -1; }
  #ui #quick-play { gap: 4px; }
  #ui #menu .title { font-size: 1.25rem; }
  #ui #quick-play .big { padding: 4px 16px; }
}
`;
