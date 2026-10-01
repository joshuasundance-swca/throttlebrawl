// The HUD's own feel numbers as tuning sliders (docs/architecture.md, "Tuning"). Every feel number
// is a slider, [default]. ui reads them straight from the registry app/ hands in, so they need no
// routing: they are live sliders as soon as app/ collects HUD_TUNING with the other modules'
// declarations, and until then ui uses the defaults below.
import type { TuningParamDecl } from '../sim/api';
import type { TuningRegistry } from '../tuning';

export const HUD_TUNING: readonly TuningParamDecl[] = [
  {
    // Playtest 1c, the live oncoming meter: a stretch shows once it has lasted this long, so a
    // brief brush with the oncoming lane does not flash a chip.
    id: 'hud.meterShowAfterS',
    group: 'hud',
    label: 'Style meter: show a run after',
    default: 0.5,
    min: 0,
    max: 2,
    step: 0.1,
    unit: 's',
    affectsSim: false,
  },
  {
    // How long the landed value stays up (its fade included) once the run has paid out.
    id: 'hud.meterLandS',
    group: 'hud',
    label: 'Style meter: landed value stays',
    default: 1.6,
    min: 0.5,
    max: 4,
    step: 0.1,
    unit: 's',
    affectsSim: false,
  },
];

const DEFAULTS: Readonly<Record<string, number>> = Object.fromEntries(
  HUD_TUNING.map((d) => [d.id, d.default]),
);

/** A HUD value: the registry's when it declares the id, else the declared default. */
export function hudParam(tuning: TuningRegistry, id: string): number {
  return tuning.decl(id) ? tuning.get(id) : (DEFAULTS[id] ?? 0);
}
