/** A compact outcome/action frame with a separately scrolling detail region. */
export function actionScreenParts(
  id: string,
  heading: HTMLElement[],
  details: HTMLElement[],
  actions: HTMLElement[],
) {
  const make = (part: string, kids: HTMLElement[]) => {
    const n = document.createElement('div');
    n.id = `${id}-${part}`;
    n.className = `action-${part}`;
    n.append(...kids);
    return n;
  };
  return [make('heading', heading), make('details', details), make('actions', actions)];
}

export const ACTION_SCREEN_CSS = `
#ui :is(#results, #career-results) { justify-content: flex-start; overflow: hidden; gap: 8px;
  padding-top: max(10px, env(safe-area-inset-top)); padding-bottom: max(10px, env(safe-area-inset-bottom)); }
#ui .action-heading, #ui .action-actions { flex: 0 0 auto; width: min(720px, 100%); }
#ui .action-heading { display: flex; flex-direction: column; align-items: center; gap: 8px; }
#ui .action-heading .title { font-size: 1.375rem; max-width: 100%; box-sizing: border-box; overflow-wrap: anywhere; }
#ui .action-details { flex: 1 1 auto; min-height: 0; width: min(720px, 100%); overflow-y: auto;
  overscroll-behavior: contain; touch-action: pan-y; display: flex; flex-direction: column; align-items: stretch;
  gap: 8px; padding: 4px; box-sizing: border-box; text-align: left; }
#ui .action-details > * { flex-shrink: 0; }
#ui .action-actions { display: flex; justify-content: center; flex-wrap: wrap; gap: 8px; padding: 4px; box-sizing: border-box; }
#ui .action-actions :is(.small, .big) { min-height: 44px; padding: 6px 14px; font-size: 1rem; max-width: 100%; }
#ui #pause-screen { overflow: hidden; justify-content: flex-start; padding-top: max(8px, env(safe-area-inset-top));
  padding-bottom: max(8px, env(safe-area-inset-bottom)); }
#ui #pause-main { flex: 0 0 auto; overflow: visible; gap: 8px; max-width: 100%; }
#ui #pause-main .title { font-size: 1.375rem; }
#ui #pause-main :is(.big, .small) { min-height: 44px; padding: 6px 14px; font-size: 1rem; }
#ui #pause-cards { flex: 1 1 auto; min-height: 0; overflow-y: auto; overscroll-behavior: contain; padding: 4px;
  box-sizing: border-box; touch-action: pan-y; }
#ui #pause-cards summary { min-height: 44px; display: flex; align-items: center; }
#ui #pause-build { flex: 0 0 auto; padding: 2px 8px; }
@media (orientation: landscape) and (max-height: 440px) {
  #ui #pause-screen { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1.3fr);
    grid-template-rows: minmax(0, 1fr) auto; gap: 6px 12px; }
  #ui #pause-main { grid-column: 1; grid-row: 1; align-self: center; }
  #ui #pause-cards { grid-column: 2; grid-row: 1 / 3; height: 100%; max-height: 100%; }
  #ui #pause-build { grid-column: 1; grid-row: 2; }
  #ui :is(#results, #career-results) { gap: 4px; }
  #ui .action-heading { gap: 4px; }
}
`;
