import type { ContentRegistry } from '../content';

/** Authored launch, braking and steering differences against the currently ridden bike. */
export function bikeComparison(
  reg: ContentRegistry,
  candidate: string,
  baseline: string | null,
): string | undefined {
  if (!baseline || candidate === baseline) return undefined;
  const bike = reg.bikes[candidate];
  const ridden = reg.bikes[baseline];
  if (!bike || !ridden) return undefined;
  const fields = ['accelMps2', 'brakeMps2', 'steerRateMps'] as const;
  if (fields.some((key) => !Number.isFinite(bike.handling[key]) || !Number.isFinite(ridden.handling[key])))
    return undefined;
  const compare = (key: (typeof fields)[number], higher: string, lower: string, equal: string) =>
    bike.handling[key] > ridden.handling[key]
      ? higher
      : bike.handling[key] < ridden.handling[key]
        ? lower
        : equal;
  const notes = [
    compare('accelMps2', 'quicker launch', 'slower launch', 'same launch'),
    compare('brakeMps2', 'stronger brakes', 'softer brakes', 'same brakes'),
    compare('steerRateMps', 'quicker steering', 'slower steering', 'same steering'),
  ];
  return `Compared with ${ridden.name}: ${notes.join(' · ')}.`;
}
