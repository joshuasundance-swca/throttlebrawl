// Each rider's engine patch for audio (playtest 2, 2026-10-02: "a voice per bike"). A rider drawn on
// a bike class (`look.bikeClass` in its pack file) sounds like that class: the base pack's
// `defaults.engineSoundByClass` gives the class's patch, which replaces the sim bike's own
// `engineSound` until the career gives riders real bikes. A rider with no drawn class, or a class
// with no entry, keeps its bike's own patch (docs/content-packs.md, "The manifest: pack.json").
import type { EngineSoundSpec } from '../audio';
import type { ContentRegistry } from '../content';

/** Audio's engine patches keyed by rider content id, for the riders of a race. */
export function engineSoundsFor(
  registry: ContentRegistry,
  riders: readonly { readonly contentId: string; readonly bike: { readonly contentId: string } }[],
): Record<string, EngineSoundSpec> {
  const byClass: Readonly<Record<string, EngineSoundSpec | undefined>> =
    registry.packs.find((p) => p.id === 'base')?.defaults.engineSoundByClass ?? {};
  const out: Record<string, EngineSoundSpec> = {};
  for (const r of riders) {
    const bike = registry.bikes[r.bike.contentId];
    if (!bike) continue;
    const look = (registry.riders[r.contentId] as { look?: { bikeClass?: unknown } } | undefined)?.look;
    const drawn = typeof look?.bikeClass === 'string' ? byClass[look.bikeClass] : undefined;
    out[r.contentId] = drawn ?? bike.engineSound;
  }
  return out;
}
