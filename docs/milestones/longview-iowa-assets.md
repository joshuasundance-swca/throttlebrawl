# Longview's squirrel bridge and Iowa's joke ride (asset brief)

`[default]` (2026-10-26, after Longview and Iowa joined the career). Two models for a Codex asset lane (AGENTS.md: assets first, own worktree, no network, no push). The coordinator places them, runs the gates and opens the PR. Both follow `tools/blender/README.md`: one script per model in `tools/blender/props/`, a catalog row (`catalog/pnw.mjs` and `catalog/iowa.mjs`), a deterministic double build, and scores inside the row's budgets.

## 1. Longview's squirrel bridge (landmark)

Longview, Washington has a real, famous little bridge for squirrels across a street near its civic centre, the Nutty Narrows Bridge. Real landmarks and their names are allowed as flavor (docs/tone-guide.md, Real places). Draw it faithfully and simply. Make no claim about its history beyond what is drawn.

- **Shape.** A narrow rope-and-plank suspension span about 18 m long and 0.3 m wide, slung between two poles or trees about 6 m up, with a shallow sag. The deck and hand-lines read at riding speed as a thin line, with one darker plank band. Add two or three small squirrels on or near the span, each a few low-poly boxes. They are scenery and never a hitbox.
- **Placement.** Over Olympia Way, on the Street Diamond's outer alternate (`osm-longview-diamond-olympia`), square to the road. The span's lowest point must stay at least 5 m over the road surface. The poles stand past the drawn verge on both sides. The builder takes the spot from the baked road data already in the pack, not from the network.
- **Budget.** Under 600 triangles, at most 4 draws (merged 3), shipped without normals unless the score needs them.
- **Node contract.** A root `squirrel_bridge` at road level under the span's middle, plus a child `squirrel_bridge_body`. Its extras carry `span_m` and `clearance_m`.

## 2. Iowa's joke ride: the pedal tractor

The fourth chapter's region boss (Mara Vale's Benchmark) grants no joke ride yet. The first three chapters grant the golf cart, the riding lawnmower and the mobility scooter. Iowa's would be a child's pedal tractor, ridden by an adult, knees up.

- **Bike file** (`packs/base/bikes/pedal-tractor.json`, tags `secret`, `joke`): top speed about 5 m/s, the slowest ride in the game. A 1.3 m by 0.7 m hitbox. Its own engine-sound preset is out of scope: use no engine sound, or the quietest existing preset.
- **Look.** A generic farm tractor in miniature: big rear wheels, small front wheels, a seat and a steering wheel, in county-fair blue with a white seat and black tyres. No maker's colours (no green-and-yellow, no tractor red), no badge and no lettering.
- **Model.** `packs/base/assets/models/bikes/pedal-tractor.glb`, with the node contract and rider mount of the other joke rides (copy `golf_cart.py`'s layout and mount empties). Under 900 triangles.
- **Grant.** `region-clinton/careers/iowa-circuit.json` adds `unlocks: [{ grant: "base:pedal-tractor", when: { kind: "boss-beaten", ref: "benchmark" } }]`. Then the exceptions added on 2026-10-26 in `src/app/career-content.test.ts` (a later chapter may grant no joke ride) come out, so every chapter's boss grants one again.

## Automated acceptance

- `npm run asset:check` rebuilds both models byte-identical, inside budget, and the catalog test (`tools/blender/models.test.ts`) passes.
- A layout test shows the squirrel bridge over Olympia Way, at least 5 m above the road along the whole drivable width, with both poles outside the riding band.
- `src/app/career-content.test.ts` passes, with every chapter's boss granting a joke ride, after the exception is removed. The ride shows only once the garage owns it (docs/product-spec.md, Bikes: secret joke rides).
- Live check by the coordinator: the bridge is visible from the chase camera on the Street Diamond's outer route, and the pedal tractor appears in the garage after Benchmark is beaten.
- Human readability and phone performance: not verified by agents.
