# Bike choice clarity

This milestone clarifies existing bike choices in the career garage and Quick Play bike notes. `[default]`
The contract lands first; the coordinator's implementation PR will populate and render the
optional UI note without changing bike behavior, content, packs, save fields, prices, speed, or
locks.

The comparison is derived from each authored bike's `accelMps2`, `brakeMps2`, and `steerRateMps`
against the currently ridden bike. Every note names that baseline. Higher acceleration says
"quicker launch" and lower says "slower launch"; higher braking says "stronger brakes" and lower
says "softer brakes"; higher steering says "quicker steering" and lower says "slower steering".
Equal values say "same". If the current-bike baseline or the candidate's comparison data is
missing, omit the comparison note. The current bike itself needs no comparison note.

Career owned, for-sale, and locked rows and Quick Play bike notes may show the authored text. The
copy must not claim anything about grip, off-road advantage, stunt success, contact immunity, or
human difficulty. Existing price, speed, lock, physics, and save fields remain unchanged.

## Automated acceptance

- Comparisons use actual pack-derived `accelMps2`, `brakeMps2`, and `steerRateMps` values, name the
  selected baseline, and cover quicker/slower launch, stronger/softer brakes, quicker/slower
  steering, and same values.
- Controls cover a changed selected baseline, equal data, and missing baseline/current-bike data;
  missing data produces no comparison note.
- Rendered garage and Quick Play notes are checked at 568x320 at every supported text size with no
  horizontal overflow.
- Existing draw-call, triangle, download, first-load JavaScript, frame-time, tests, lint, types,
  bot playthrough, performance, changelog, and leak-scan gate checks remain green.

The contract-first PR contains only the two optional garage view fields and this plan/note. Quick
Play's existing option note requires no new field. The coordinator may build the implementation on
this branch immediately, and opens its PR after the contract lands. The coordinator owns its tests
and central gate.
