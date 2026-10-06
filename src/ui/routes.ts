// The route picker (the maintainer, 2026-10-01: "Yes, add as routes"): after the region, the player
// picks a route. The region's hand-made road is the default; each real road the region carries is
// listed by its real name. app/ hands the list in (`routeChoices`), ui draws it under the region
// picker and reports the pick. Phone-first: chips are full-size touch targets in one row that
// scrolls sideways when the names do not fit, so the Race button never leaves the screen.

/** One route the player can pick, as plain data (app/ maps its route choices to it). */
export interface RouteOption {
  /** The route's qualified id, or null for the region's own road (the default). */
  id: string | null;
  /** The name on the chip, such as "Chuckanut Drive". */
  name: string;
  /** One line under the chips for the picked route. */
  blurb?: string;
}

/** The list app/ gave, cleaned: no blank names, and no route twice (the first one stays). */
export function cleanRoutes(options: readonly RouteOption[]): RouteOption[] {
  const out: RouteOption[] = [];
  for (const o of options) {
    if (!o.name.trim() || (o.id !== null && !o.id.trim())) continue;
    if (out.some((k) => k.id === o.id)) continue;
    out.push(o);
  }
  return out;
}

/**
 * The route to show as picked: `wanted` when it is in the list, else the region's own road (null)
 * when it is offered, else the first option; null for an empty list.
 */
export function pickRoute(options: readonly RouteOption[], wanted?: string | null): string | null {
  if (wanted && options.some((o) => o.id === wanted)) return wanted;
  if (options.some((o) => o.id === null)) return null;
  return options[0]?.id ?? null;
}

/** The chip's element id: `route-own` for the region's road, else from the route's id. */
export const routeChipId = (id: string | null): string =>
  id === null ? 'route-own' : `route-${id.replace(/[^a-z0-9-]/gi, '-')}`;

export const ROUTE_PICKER_CSS = `
#route-picker { display: flex; flex-direction: column; align-items: center; gap: 4px; max-width: min(560px, 92vw); }
#route-picker .route-label { font: 800 0.75rem ui-monospace, 'Courier New', monospace; letter-spacing: 0.12em;
  text-transform: uppercase; background: #111; color: #f2ead8; padding: 1px 8px; transform: rotate(-1deg); }
#route-picker .route-row { display: flex; gap: 10px; flex-wrap: nowrap; overflow-x: auto; max-width: 100%;
  padding: 2px 4px 5px; box-sizing: border-box; scrollbar-width: none; -webkit-overflow-scrolling: touch; }
#route-picker .route-row::-webkit-scrollbar { display: none; }
#route-picker .route { font-size: 0.875rem; white-space: nowrap; flex: 0 0 auto; }
#route-picker .route[aria-checked='true'] { background: #111; color: #f5c542; box-shadow: 3px 3px 0 #e0543a;
  transform: rotate(1deg); }
#route-picker .route-blurb { font: italic 500 0.8125rem/1.3 ui-monospace, 'Courier New', monospace; color: #f2ead8;
  text-shadow: 1px 1px 0 #111; max-width: 100%; }
#region-picker.route-picked .region-blurb { display: none; }
`;

export interface RoutePicker {
  /** The picker's element, for the menu. Hidden while there is no choice to make. */
  readonly root: HTMLElement;
  /** The routes to offer and the one to show as picked (the region's own road when left out). */
  set(routes: readonly RouteOption[], picked?: string | null): void;
  /** The picked route's id, or null for the region's own road. */
  readonly route: string | null;
}

/**
 * The picker under the region chips: a "Which road" label, one chip per route, and a real road's
 * blurb (the region's own blurb stands for its own road, so one line of blurb shows at a time and
 * the menu fits a phone held sideways). It hides while there is only one road to ride (or none).
 * `button` makes a chip in the menu's zine style; `onChange` hears each pick; `onDraw` hears every
 * redraw with whether a real road's blurb is showing.
 */
export function createRoutePicker(
  button: (id: string, text: string, onClick: () => void) => HTMLButtonElement,
  onChange: (id: string | null) => void,
  onDraw: (realRoadShown: boolean) => void = () => undefined,
): RoutePicker {
  let routes: RouteOption[] = [];
  let route: string | null = null;
  const label = document.createElement('div');
  label.className = 'route-label';
  label.textContent = 'Which road';
  const row = document.createElement('div');
  row.className = 'route-row';
  row.setAttribute('role', 'radiogroup');
  row.setAttribute('aria-label', 'Road');
  const blurb = document.createElement('div');
  blurb.className = 'route-blurb';
  const root = document.createElement('div');
  root.id = 'route-picker';
  root.hidden = true;
  root.append(label, row, blurb);

  const draw = () => {
    root.hidden = routes.length < 2;
    row.replaceChildren(
      ...routes.map((o) => {
        const b = button(routeChipId(o.id), o.name, () => tap(o.id));
        b.classList.add('route');
        b.dataset['route'] = o.id ?? '';
        b.setAttribute('role', 'radio');
        b.setAttribute('aria-checked', String(o.id === route));
        return b;
      }),
    );
    const picked = routes.find((o) => o.id === route);
    const real = !root.hidden && picked !== undefined && picked.id !== null && !!picked.blurb;
    blurb.textContent = real ? (picked.blurb ?? '') : '';
    blurb.hidden = !real;
    onDraw(real);
  };
  const tap = (id: string | null) => {
    if (id === route) return;
    route = id;
    draw();
    onChange(id);
  };
  return {
    root,
    set(list, picked) {
      routes = cleanRoutes(list);
      route = pickRoute(routes, picked ?? null);
      draw();
    },
    get route() {
      return route;
    },
  };
}
