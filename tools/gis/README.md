# tools/gis: the real-road bake

The offline pipeline of the GIS side quest ([gis-1 in M2.md](../../docs/milestones/M2.md#gis-1--the-real-overseas-highway-side-quest-running-since-m1)).
It bakes a stretch of the real Overseas Highway (US 1 through the Florida Keys) from public data
into the same baked road format the hand-made track uses
([the road format](../../docs/content-packs.md#road-networks-roads-and-routes)). The game never
talks to any of these services: it reads the committed pack files. CI never runs this tool; its
output is gated by `npm run packs:check` and the unit tests like any pack file.

## Run it

It is its own small Python project, managed with [uv](https://docs.astral.sh/uv/).

```sh
cd tools/gis
uv sync
uv run tbgis probe                                  # the Keys data probe -> probe/keys-us1.md
uv run tbgis bake configs/osm-keys-bahia-honda.json  # -> packs/base/regions/florida-keys/*/osm-*.json
uv run tbgis bake configs/osm-pnw-gorge.json         # -> packs/region-pnw/regions/pacific-northwest/*/osm-*.json
uv run tbgis network networks/osm-pnw-samish.json    # a network: several real roads and their junctions
uv run tbgis loops configs/osm-sf-twin-peaks.json --max-streets 3  # where the real map offers a choice
cd ../.. && npm run format                           # match the repo's Prettier style
uv run --directory tools/gis pytest                  # the pipeline tests (plus ruff and mypy)
```

Every bake also writes `reports/<id>.fun.json`: corners, the tightest radius, grades, launch
crests, junctions, bridges, tunnels and how far the smoothed line drifts from the real one
(`src/tbgis/fun.py`). A network bake writes the same numbers for each of its lines, after the
closure, in `reports/<id>.network.json` (`lines.<line>.fun`).

## Beyond the Keys: street routes and high country

The new regions (Pacific Northwest and San Francisco) needed a few config switches, each off by
default so the Keys bake is unchanged. Their bakes are in the region packs as real-road routes
([The region bakes](#the-region-bakes), below).

- `osmQuery`: the config's own Overpass query (default: the Keys US 1 query). A cached extract is
  reused only for the exact query that fetched it, and the 3DEP cache records a hash of its points,
  so an edited config never bakes from a stale extract.
- `routeTags`: regexes the path's ways must match (for example a street-name list); every way in the
  extract still counts toward the junctions report.
- `via`: waypoints, so a street route takes named turns. A waypoint that would force a U-turn is
  refused (the road format has none).
- `respectOneway: false`: a race closes the streets, so one-way streets can be ridden either way.
- `splitAt` and `splitOnNameChange` (with `minRoadM`): named sections on a long road, or one road
  per street; `realNameFromOsm` takes each road's `realName` from OSM.
- `elevation.bridgeDeck: "span"`: a deck runs straight between its banks, for creek and ravine
  bridges in hill country (the default `"sea"` deck sits above the water, as on the Keys). The deck
  replaces the valley before the low-pass, so land and deck meet smoothly.
- `outRoot`: where the files go, relative to the repo root (default: `packs/base/regions/<region>`).
  A region pack's bake names its own pack's region folder.
- `realName`, `waysLabel`, `networkNotes` and `route.notes`: the words the Keys bake had built in.
- `laneWidthM`: each travel lane's width (default 3.4 m, the M1 table the Keys bake carries). The
  region bakes use 4.0 m, as the hand-made roads have since playtest 1 ("road too narrow to weave").
- The cross-section (W-Q): `lanesPerDirection` (1 to 3 drive lanes each way, default 1),
  `medianM` and `medianKind` (a gap between the directions, default none), and `verges` (`left`
  and `right` bands of `widthM`, `surface` and `edge`, written into every road's lane section). Left
  out, the game derives each verge from the road's tags and barriers. The defaults bake exactly the
  M1 lane table, so the committed bakes are unchanged.
- Per road, `tags` (scenery tags for both sides) cover the whole road except its bridges, so the
  renderer never stands scenery on a deck. A `"span"` deck gets the `bridge` tag only: it crosses a
  creek or a ravine, not open water, so no boats float below it. `features` take every road-file
  kind, `boostPad` and `rampTruck` included (with numeric `params` and a `slot`), and a `billboard`
  slot names a region `item` or a `pool` (`signs` or `billboards`).
- USGS `getSamples` answers at most 1,000 points per request and silently drops the rest, so longer
  stretches go in batches.

## The region bakes

Four real stretches are routes in the region packs, beside each region's hand-made road (the
maintainer, 2026-10-01: "Yes, add as routes"). app/ lists them for the race setup's route picker
by name (`routeChoices`; [Region packs at runtime](../../docs/content-packs.md#region-packs-at-runtime)).

| Region pack | Config | Route (picker name) | Roads |
|---|---|---|---|
| `region-pnw` | `osm-pnw-chuckanut` | `osm-chuckanut-run` (Chuckanut Drive): WA SR 11, southbound from above Larrabee State Park | `osm-chuckanut-larrabee`, `-cliffs`, `-oyster-creek` |
| `region-pnw` | `osm-pnw-gorge` | `osm-gorge-run` (Columbia River Highway): the Historic Columbia River Highway, eastbound from the Women's Forum viewpoint through the Crown Point loops to Shepperd's Dell | `osm-gorge-crown-point-loops`, `-latourell`, `-shepperds-dell` |
| `region-sf` | `osm-sf-russian-hill` (a network since run W-U: [Networks](#networks-real-roads-joined-at-real-junctions)) | `osm-sf-hills-run` (Russian Hill): Hyde over Russian Hill and Nob Hill, California down to Kearny, Columbus, Union back over the hill, then Leavenworth | one road per street: `osm-sf-hyde`, `-california`, `-kearny`, `-columbus`, `-union`, `-leavenworth` |
| `region-sf` | `osm-sf-twin-peaks` | `osm-sf-twin-peaks-run` (Twin Peaks): Upper Market from Sanchez, Portola, then Twin Peaks Boulevard to the summit | `osm-sf-upper-market`, `-portola`, `-twin-peaks-climb` |

Each network keeps its own frame origin, since it never shares a scene with the region's hand-made
road (Chuckanut is about 120 km north of `pnw-c1`'s origin, the Gorge about 230 km south). The
configs add the race dressing: the region's scenery tags (forest in the Pacific Northwest, row
houses in San Francisco), a cop lot at the start, pedestrian zones, sign and billboard slots from
the region's pools, and seeded set pieces (two pad slots per route, and a ramp-truck slot where a
flat straight is long enough: not on Twin Peaks). Every truck and pad candidate is ridden in
`tests/sim/road-setpieces-live.test.ts`, the bot races each route in `tests/sim/road-real-routes.test.ts`,
and `tools/gis/region-routes.test.ts` checks the licence rules, the road lint and that the scenery
stands on land.

From `reports/<id>.fun.json` (the bake computes every number):

| Stretch | Length | Corners | Tightest | Turning (deg/km) | Radius < 100 m | Elevation (climb/drop) | Max grade | Steeper than 8% | Launch crests | Junctions | Bridges | Max drift |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `osm-pnw-chuckanut` | 7.62 km, 3 roads | 7 | 40 m | 144 | 3.9% | 25..77 m (+86/-134) | 12.3% (p95 5.5%) | 2% | none | 6 (0.8/km) | 0 m | 19 m |
| `osm-pnw-gorge` | 7.63 km, 3 roads | 30 | 27 m | 392 | 24.1% | 37..236 m (+57/-228) | 12.5% (p95 6.3%) | 2% | none | 4 (0.5/km) | 232 m | 33 m |
| `osm-sf-russian-hill` (main line, network bake) | 5.35 km, 8 roads | 5 | 16 m | 83 | 3.4% | 10..95 m (+210/-211) | 22.4% (p95 18.1%) | 45% | 1 (from 34.2 m/s) | 62 (11.6/km) | 21 m | 7 m |
| `osm-sf-twin-peaks` | 5.66 km, 3 roads | 23 | 17 m | 363 | 22.9% | 40..260 m (+237/-16) | 8.9% (p95 8.3%) | 14% | none | 31 (5.5/km) | 164 m | 16 m |

- **Corners** are runs tighter than a 150 m radius that turn at least 20°. **Turning** is the total
  heading change per km.
- **Launch crests** are where a bike following the road would leave the ground below the starter
  bike's 44.7 m/s top speed (`sqrt(g / c)` for a crest of vertical curvature `c`): a physics
  estimate; the game's own airborne rule decides what happens.
- **Junctions** count public roads meeting the route (driveways and parking aisles left out). They
  are pass-through only: the route has no turns there, and no side road is baked.
- **Max drift** is how far the smoothed line strays from the real OSM line. Fine for racing; it
  matters only if scenery is ever placed from real-world coordinates.
- Twin Peaks finishes at the summit: the through road over the top is car-free in OSM, so the route
  stops there, its finish 80 m short of the road's end, off the summit hairpin.

## Networks: real roads joined at real junctions

Run W-S (interview, 2026-10-02: "map-based networks", "junction choices in races", "multi-lane
highways"). A stretch bake follows one real road with pass-through junctions only; a network bake
(`tbgis network networks/<id>.json`, `src/tbgis/network.py`) joins several real roads at their real
junctions, in the same baked format the hand-made tracks use for their shortcuts, so a race gets a
real junction choice.

- **Lines.** A network config names `lines`, each one real path through the OSM graph exactly as a
  stretch config's (`pathFrom`, `via`, `pathTo`, `routeTags`, `respectOneway`, `splitAt`,
  `splitOnNameChange`), with its own smoothing, elevation and cross-section, and per road its own
  lanes (`roadLanes`: a four-lane boulevard narrowing into a side street) and tags for one side only
  (`sideTags`: the beach on one side). Compression is off, so the lines keep their real lengths.
- **Branches.** A branch line leaves a main line at a real junction (`leave.at`) and rejoins it at
  another (`join.at`). The bake cuts a junction piece out of the main line (its main-through
  connector road, one row per drive lane both sides have), starts and ends the branch's own roads
  `insetM` inside it, and solves a turn-off and a rejoin connector between them (a turn, a straight
  and a turn, the hand-made compiler's shape) that leave and land with each road's heading. The
  turn-off's row carries the split zone (`leave.zone`, on the right: keep right to take it). Both
  connectors carry one `shortcut` lane, so traffic stays on the main road; the branch's own roads
  keep their real lanes and carry none. `shiftM` moves a junction along the main line off the real
  gore (at a wide fork the main road already bends there; beside a ramp the connector then stands in
  for the ramp's first stretch, where the two roads' land would overlap). A branch's `id` must be
  its first road's (the id the game derives, so a career's `route#id` holds); `label` names the
  generated junction roads.
- **The closure.** Positions are integrated from the smoothed heading, so a line drifts off the real
  map: about 6 m over one city block (run W-O's probe) and 0.4 to 43 m at these networks' junctions.
  Each line is pinned back at every junction it meets: the error there is spread back along it with
  a smoothstep between anchors, the line is resampled at uniform arc length, and each road's stored
  curvature is the turn between its own samples, so positions and curvature agree by construction.
  `network.json` reports what each junction drifted (`reports/<id>.network.json`).
- **Routes** run along one line, from a start road to a finish road; each allows the junction pieces
  in its span and every branch that leaves and rejoins inside it, and names those branches.
- The bake runs the game's network rules before it writes (`lint_network` in `src/tbgis/lint.py`,
  after `src/road/validate.ts`: junction radius, connector ends meeting their roads within 0.5 m and
  3 degrees, split zones at the end they leave from, no drive lane onto a shortcut road), and removes
  the files an earlier bake of the same config wrote and this one did not.

| Network (pack) | Route (picker name) | Main line | Junction choice | Drift closed |
|---|---|---|---|---|
| `osm-keys-key-west` (base) | `osm-key-west-run` (Key West), 7.17 km | the Overseas Highway (US 1) over Stock Island and Cow Key Channel, South Roosevelt Boulevard along Smathers Beach, Bertha and Atlantic to Higgs Beach: four lanes, two from Bertha | North Roosevelt Boulevard, right at the Triangle, back down Truman Avenue and White Street to Atlantic: a shortcut, 170 m shorter | 14.8 and 40.4 m (main), 13.2 m (branch) |
| `osm-pnw-samish` (region-pnw) | `osm-i5-samish-run` (I-5 by Lake Samish), 7.22 km | Interstate 5 southbound over the Chuckanut Mountains: four lanes, a 4 m grass median | Lake Samish's north and east shore roads, off at exit 246, on at the Nulle Road on-ramp: an alternate, 250 m longer | 0.4 and 4.2 m (main), 43.2 m (branch) |
| `osm-sf-russian-hill` (region-sf) | `osm-sf-hills-run` (Russian Hill), 5.27 km | the stretch bake's path exactly (run W-U): Hyde over Russian Hill and Nob Hill, California, Kearny, Columbus, Union back up the hill, Leavenworth down to the finish; two lanes | Jones Street, right off Union one block before its crest, down the hill's 29% north face and back along Chestnut onto Leavenworth: an alternate, 28 m shorter | 7.9 and 8.4 m (main), 6.5 m (branch) |
| `osm-pnw-portland` (region-pnw) | `osm-bridge-city-run` (Bridge City), 4.61 km | downtown Portland (playtest 3, T9.4): East Burnside over the Burnside Bridge, West Burnside, south down Broadway past Pioneer Courthouse Square, east on Madison, over the Hawthorne Bridge to SE Hawthorne: two lanes each way | the Morrison Bridge, left off Broadway onto Alder, over the river and down Grand Avenue back onto Hawthorne: an alternate, 142 m shorter | 5.4 and 11.2 m (main), 9.9 m (branch) |
| `osm-sf-golden-gate` (region-sf, T9.3) | `osm-sf-golden-gate-run` (Golden Gate), 6.04 km | Hawk Hill down Conzelman Road's hairpins to Alexander Avenue, US 101 southbound from Vista Point across the bridge and through the toll plaza (no `routeTags`: the shortest path over the extract is the real line); six lanes and a barrier median on the deck | none (a gap goes only on a branch, and traffic runs the main path) | 28 m at most (a 6 km line pinned only at its ends) |
| `osm-sf-lombard` (region-sf, T9.3) | `osm-sf-lombard-run` (Lombard Street), 1.83 km | Lombard Street from Polk over the crest at Hyde, down the crooked block (the real eight hairpins: one lane, one way, red brick), on along Lombard to Telegraph Hill Boulevard and up to the circle at Coit Tower | none | 5 m at most |

Key West's frame origin (24.5675, -81.7475) is the one, of the 11 tried, that draws its busiest view
(Stock Island looking west at the Triangle, where US 1 runs straight on into North Roosevelt) in
the fewest 512 m road chunks: 77 of the still scene's 80 draw calls (`src/render/scene-cost.test.ts`;
77 to 85 over the origins tried). East Lake Samish Drive runs within 7 m of I-5's edge for 800 m, at about its height; the land walk
in `region-routes.test.ts` (every raised land edge closed down to the ground) passes there with
render's #377, and beside the exit 246 off-ramp with the junction moved by `shiftM`.

Russian Hill (run W-U) was the stretch bake `configs/osm-sf-russian-hill.json`; its network config
replaces it, so one config owns its files. The main line is the stretch's path with the stretch's
smoothing, elevation, lanes and features, and it keeps the ids the career and the tests name: the
network, the route and every road (Hyde, California, Kearny, Columbus, Union, Leavenworth). The
junctions cut two of them: Union into `osm-sf-union` and `osm-sf-union-crest`, Leavenworth into
`osm-sf-leavenworth` and `osm-sf-leavenworth-north` (the finish road; its billboard moved onto it).
The closure moved Hyde at most 4 m and brought the line's largest drift from the real streets
from 10 m to 7 m. Jones and Chestnut are their own roads, so the corner between them falls on a
join like the route's other street corners: a 16 m corner in the middle of one road left a sliver in
render's land-seam walk (`src/render/land-seam.test.ts`). The turn-off and the rejoin start and land
a little early (`shiftM` -10 and 10, `insetM` 50 and 45, `turnsM` 50 and 45) so they bend at 16.6 and
15.8 m radius, about as tightly as the route's own corners (the first try, at the default turns,
bent at 8.6 and 8.1 m). A rider at speed leaves the ground where Union's rise meets Jones's drop,
the city's own ramp. The junction sign (`jones-keep-right`) stands on Union's right just before the
split zone, 50 to 60 m before the split.

### Where the real map offers a choice: `tbgis loops`

`uv run tbgis loops <config> [--line <id>] [--max-streets 3]` (run W-U, `src/tbgis/loops.py`) reads
the extract a stretch or a network line bakes from and lists the real loops off its route: from each
junction on it, the shortest way through the other public roads (driveways, parking aisles and
private roads left out) that comes back onto the route further along. It keeps the ones that make a
race choice, 0.7 to 2 times the stretch they replace (a route that comes back on itself, like Russian
Hill, has cross streets that would skip nearly all of it), and drops the other carriageway of a
divided road. It writes `reports/<label>.loops.json`, the closest to the stretch first.

| Route | Real loops (at most 3 streets) | What they are |
|---|---|---|
| Russian Hill (`hills` line) | 230 | the grid: equal-length alternates everywhere inside the route's corners; built: Jones and Chestnut (565 m for 565 m in the probe) |
| Twin Peaks | 15 | off Upper Market: a 430 m alternate under the 18th Street interchange (Storrie and 18th), and detours, among them Corbett Avenue (1,690 m for 1,427 m, behind two hairpins at Danvers) and Grand View Avenue with Clipper Street (1,496 m for 1,234 m) |
| Columbia River Highway | 1 | a detour through Latourell's streets, 1,319 m for 682 m |
| Chuckanut Drive | 0 | |
| Key West (`us1` line) | 17 | all detours, from a third longer (George, Patricia and Steven, 643 m for 484 m) to several times longer, through the side streets off Atlantic and Bertha and the airport loop; the built Boulevard choice runs over more than 3 streets |
| I-5 by Lake Samish (`i5` line) | 2 | an exit ramp pair, and the built lake road's first loop |
| Bahia Honda | unknown | its extract holds only US 1, so no side road is in it |

None of the loops off Twin Peaks, the Gorge or Key West is built: each is longer, with nothing on it
yet, and a longer way with nothing on it is a trap, not a choice.

## Playtest 3: jumps, gaps, landmarks and staging

Playtest 3 (T9.1; the maintainer, 2026-10-03: "the 7 mile bridge has an old road parallel to it.
Jumps could let you get from one to the other"; round 3: "the real 80 m missing span is the big
jump"; round 1: "real landmarks") needs the bake to write the road format's playtest 3 fields
(`src/road/types.ts`, [Gaps and landmarks](../../docs/content-packs.md)). Every switch is off by
default. When they landed, the code before and after baked the Russian Hill network and the Twin
Peaks stretch from one cached extract to byte-identical files.

- **The feature kinds** are the game's, `landmark` included. `src/tbgis/config.py` holds the list,
  the barrier looks and the gap respawn places, and `tests/test_capabilities.py` reads them out of
  `src/road/validate.ts`, `src/core/surfaces.ts` and `src/road/types.ts`, so the two cannot drift.
  Feature `params` keep JSON booleans (a landmark's `overRoad`, a solid hazard's `solid`).
- **Ramp lips.** A `ramp` feature with `params.heightM` (and `lengthM`, `backM`) is built into the
  elevation exactly as the hand-made compiler builds one (`rampProfile` in `src/road/compile.ts`):
  a kicker `y = h·u²` over `lengthM`, then the back over `backM`. Its `s1` must be
  `s0 + lengthM + backM`. The lip moves onto a sample, and the range moves with it. A `ramp`
  without `heightM` only marks a range, as before.
- **Stitches** (`stitches` on a stretch config or a network line): `{id, from: {lat, lon}, to,
  trimM, kicker?, params?}` joins the two way nodes nearest `from` and `to` (each within `snapM`,
  5 m) with a straight bridge deck, across a span the map does not draw. A `gap` stitch, the
  default, also writes a `gap` feature over it, `trimM` in from each end and across the road's
  width, with its `params` (`killDepthM`, `respawn: "main"` for the Moser Channel, `respawnPastM`).
  A `kicker` (`heightM`, `lengthM`) adds a built ramp whose lip is the gap's start, and whose back
  falls to the deck over the first half of the gap, where nobody rides (T9.2: a lip that dropped to
  the deck in one sample broke the game's grade rule, which the bake's lint now runs too). Gaps go on a
  network's branch line, never a main path, since traffic runs the main path; a stretch bake
  refuses a gap stitch. A `deck` stitch only joins the ends.
- **The way filter** (`wayFilter` on a stretch config or a line): groups of tag regexes, and a way
  carries the path when it matches every regex of any one group (`@id` matches the way id). It
  goes on top of `routeTags`. The old bridge's ways are `highway=pedestrian`,
  `abandoned:highway=trunk` and a bare `bridge:name`, so a filter like
  `[{"name": "^Old Seven Mile Bridge$"}, {"bridge:name": "^Old Seven Mile Bridge$"}, {"@id": "^39107118$"}]`
  paths them and nothing beside them (a fishing pier, say). The network's `osmQuery` has to fetch
  them.
- **Per-road spacing** (`sampleSpacingM` on a road, 1 to 10 m). A long straight bridge at 6 m costs
  about a third of the road data it would at 2 m. Base's real-road data gates every race, so this
  matters for the Seven Mile.
- **Barriers.** Per road, `barriers: [{s0, s1 (or "end"), side, kind, heightM, jumpable?, look?}]`
  are added beside the bridge rails. Only a `wall` may be `jumpable`. `bridgeBarrier: {kind,
  heightM, look}` (on a stretch config or a line) changes what stands along every bridge; the
  Golden Gate's is a `wall` that `look`s like a `railing`. Left out, every bridge keeps its rail.
- **Landmarks** (`landmarks` on a network line): `{id, model: "<asset id>#<node>", at: {lat, lon},
  footprintM: [along, across], side?, yawDeg?, scale?, farM?, overRoad?}` becomes a `landmark`
  feature on the road beside it. The point is projected onto the line's **real** OSM polyline,
  because the smoothed line drifts up to 43 m between junctions. Its (s, d) are then mapped into
  the baked road, so a buoy on a corner stays on that corner. `side` makes the bake refuse a point
  that falls on the other side (a typo, or the wrong line). The box must lie on one road. The
  network report lists each landmark's road, s, d and `placementErrorM`, how far the baked
  placement lands from the real point. The pack check alone runs the footprint rule
  (`landmark-clear`), since it needs the derived verges.
- **Synthetic branch ends** (`leave.synthetic` / `join.synthetic`, for the Seven Mile's staging).
  The branch leaves or joins the main line where the map has no junction, on a turn of `turnDeg`
  (positive to the right) with its tightest radius `turnRadiusM`, a straight of `straightM` and a
  turn back. The bake finds where that shape meets the branch line and starts (or ends) the branch's
  own road there. It then solves the curve exactly onto it, which nudges the straight and the turn
  angle; the report's `branches[].leave` and `.join` give the solved numbers. A junction's road ends
  lie within 60 m of it (`src/road/validate.ts`), so a synthetic end is two roads. One is the
  junction's connector (the turn off the main road, or onto it). The other is an ordinary staging
  road (`roadId`), with the straight and the other turn, joined end to end with the branch road
  (so `toOffsetM` and `fromOffsetM` stay 0). The `features` (a `rampTruck`, a `gap`) stand on the
  straight, s measured from its start, and the bake moves them onto the staging road. A synthetic
  leave's staging road is the branch's first road, so the branch's `id` is its `roadId`. `tags`
  dresses both (`["bridge", "water-open"]` over the sea).
- **`aiTake`** on a branch (0 to 1) goes into the route's branch entry: the share of rivals who
  take it. The Seven Mile's old road says 0 (round 3: "rivals and cops on the highway only").
- **The bake's own lint** (`src/tbgis/lint.py`) now also runs these rules, so a bad bake fails
  before it is written:
  - the jump lint: from a ramp, gap or ramp truck to its expected landing, `|kappa|` stays at or
    below 0.002;
  - the grade rule (T9.2): stored grade agrees with the elevations outside every ramp's range, as
    `src/road/validate.ts` checks it;
  - a gap's and a landmark's params;
  - jumpable walls and barrier looks;
  - no gap on a route's main path;
  - the scenery tags playtest 3 adds (`conch-houses`, `key-oldtown`, `old-bridge`, `pdx-blocks`,
    `rail-line`, `brick-street`, `headlands`).

- **T9.3's switches** (the Golden Gate and Lombard bakes; each off by default, and on the same cached
  extract and elevation the old code and the new baked the Russian Hill network and the Twin Peaks
  stretch to byte-identical files):
  - `bridgeWays` (a line): OSM way ids that count as bridge though the map leaves the tag off. The
    Golden Gate's Marin approach viaduct (way 1560010152, 108 m between two tagged runs) crosses a
    gulch, and bare-earth land under it would pull the deck down 20 m.
  - `elevation.waterBridgeMinM`: a `"span"` deck (straight between its abutments' heights, with the
    hump) at least this long stands over open water and gets `water-open`, as a `"sea"` deck does.
    A short deck over a road keeps none. The Golden Gate's is the 2.74 km deck with a 3.6 m hump over
    the main span: 74 m at Vista Point, about 67 m over the middle, 56 m at the toll plaza.
  - `crossSection.oneWay` (a line, or one road through `roadLanes`): one forward lane, centred, no
    shoulders. The road format's width rule is `|kappa| * dMax < 0.5`, and a two-way table has dMax
    4.75 m (a 9.5 m radius at the tightest); one lane has 2 m (4 m). Lombard's crooked block turns at
    5.3 m. The roads either side stay two-way, and the join narrows like any lane drop.
  - `roadSurface` (a line): a surface per road id where it differs from the line's (the block is
    brick, its street asphalt).
  - `roads[].realName`: what the picker calls the road when the map's own name is not the one to show
    (OSM's "Golden Gate Bridge" is shown as "Golden Gate").
  - A road sampled at 1.2 m or finer keeps a tight turn's chord within the lint's 0.01 m of its
    spacing (2 m samples on a 5 m radius are 0.013 m short); the crooked block is sampled every 1.2 m.

Left-side split zones need no new switch. A branch leaves to the left with a negative `offsetM` and
a zone at negative d; `tests/test_capabilities.py` bakes one.

### Bridge City: downtown Portland (T9.4)

`networks/osm-pnw-portland.json` (`uv run tbgis network networks/osm-pnw-portland.json`) is the first
bake to use the left-side split and a landmark. It bakes one extract (the 2.5 MB Overpass answer for
`45.500,-122.690,45.532,-122.640`, every public street class) into 15 roads and the route
`osm-bridge-city-run` (4.61 km). What it decided, each from a measurement:

- **The line** is `respectOneway: false` (a race closes the streets): East Burnside's one-way
  carriageways, Broadway southbound and Madison eastbound ride as two-way roads of two lanes each way.
  The Hawthorne Bridge is three parallel ways in OSM (two one-way carriageways and a two-way one); the
  line follows the eastbound carriageway and the road is as wide as two lanes each way.
  `splitBridgeMinM` is 2000 so the 1.1 km Hawthorne deck and its approaches stay one road.
- **Smoothing** is `headingSigmaM: 14`. At 10 m the grid's 90-degree corners (Broadway into Madison)
  failed the road lint's `|kappa| * dMax <= 0.5` for four lanes (0.58 to 0.60); at 14 m the tightest
  radius is 22 m.
- **Elevation** is `bridgeDeck: "span"`: Portland's decks run between their banks (14 to 21 m above
  sea level on the 3DEP bare earth), not a few metres over the water. The route climbs 27 m and
  drops 50 m, 6.3% at the steepest.
- **The choice** leaves Broadway to the left onto Alder (a left turn, since the loop turns left), crosses
  the Morrison Bridge and comes back down Grand Avenue onto Hawthorne at the end of its viaduct. The plan
  kept it only within 15% of the leg it replaces; it is 142 m (6.4%) shorter (2,074 m for 2,216 m,
  the connectors and junction pieces counted). Its rejoin lands in the main road's right-hand lane (`offsetM: 2`,
  `lane: "R1"`): the first try landed at d -7 as the left-side test in `tests/test_capabilities.py`
  does, which puts a rider into the oncoming lane, and `tools/road/branch-rejoins.test.ts` refused it.
  Its join is moved 20 m east of the real junction (`shiftM: 20`): joined straight, the sweep in `tests/sim/geometry-land.test.ts`
  found one open land edge at Grand Avenue's end (3.9 m drop, 35 m left of the road), and a 20 m shift
  closes it. A larger shift breaks the lint's 60 m rule for a junction's road ends.
- **Dressing:** two boost-pad slots on the main road (Burnside and the Hawthorne deck), a cop lot, the
  junction sign, and a pedestrian zone beside Pioneer Courthouse Square on Broadway's left.
  T10.5 adds the downtown's people and signs: sidewalk `roadsideZone`s that name their `kinds`
  (a commuter crowd on each street, the courthouse square's, the food-cart pod's diners), four site
  signs, and `deckTags: ["pdx-deck"]` on the five roads that carry a bridge run (a bridge deck holds only
  the `bridge` tag, so the deck needs a tag of its own for the traffic area that gives downtown its
  cars and keeps the forest's trucks off the bridges). The OSM extract is not in the repo, so these
  were written into the baked roads by hand to match what the bake writes;
  `routes-pnw-dressing.test.ts` holds the config and the roads to each other. The scenery
  tags are `pdx-blocks` and `town`; `rail-line` is on Grand Avenue only: of the OSM tram and light-rail
  ways, the only ones that run along a baked road are the streetcar's on Grand (all 496 m of it lies
  within 12 m of a rail; no other road has more than 56 m, a street crossing, and the check finds
  rails where they are: it reads Grand's full length).
  `pdx-blocks` and `rail-line` draw nothing until the render lane's Portland work (T12.4).
- **Landmarks:** the two Hawthorne lift towers, `pdx-landmarks#pdx_lift_tower` (`overRoad`), at the
  ends of OSM's 75 m lift span, on the deck (placement 3.5 and 3.1 m from the real points). CX4 built the kit
  under those names (`models/landmarks/pdx-landmarks`, region-pnw), so they draw. The kit also holds the
  Burnside operator towers (`pdx_bascule_pier`), the roof sign (`pdx_roof_sign`) and the square
  (`pdx_plaza`); this config does not place them yet.
- **Size:** 17 files, 200 KB minified, 56.2 KB gzip. The three bridge roads sample every 4 m.
  The still scene on the main path draws at most 58 of 120 calls (mean 37) before the Portland
  facades (T12.4) add theirs.

## Playtest 3: Duval Street and the Seven Mile Bridge

T9.2 baked the first two playtest 3 places in the base pack (the Keys), both networks with their own
frame origin. Two more switches, both off by default, so every earlier bake is unchanged:

- `elevation.humpAt` (`{lat, lon}`): the navigation hump stands over that real point, on the long
  bridge that holds it, instead of at each long bridge's middle.
- `deckTags` on a road: tags written over its bridges only, beside `bridge` (the Old Seven Mile
  Bridge's `old-bridge` deck look). A road's `tags` still never reach a deck.

| Network | Route (picker name) | What it is | Numbers (from the bake) |
|---|---|---|---|
| `osm-keys-duval` | `osm-duval-run` (Duval Street), 3,453 m | From Mallory Square south down Whitehead Street past the Mile 0 marker to the Southernmost Point buoy, left along South Street, then all of Duval Street north to Front Street | two right-angle corners, the tightest 15.9 m; 7.7 m largest drift; landmarks: the buoy (5.3 m from its OSM point after the corner's smoothing), the Mile 0 marker (stood on the sidewalk, 5.4 m out from its OSM point on the road's edge) and Mallory Square's pier (7.9 m) |
| `osm-keys-seven-mile` | `osm-seven-mile-run` (Seven Mile Bridge), 11,649 m | US 1 from Knights Key over the 1982 bridge (10.85 km of deck at 6 m samples) to Little Duck Key, the 13 m hump over Moser Channel; the Old Seven Mile Bridge to the north from its four OSM ways (way D onto Little Duck Key included, the 19 m and 17 m breaks between its OSM ways joined by deck stitches) | the old road, an `alternate` with `aiTake` 0, 10,084 m against the highway's 10,036 m between its two repair platforms; the Moser gap 64.5 m (the 79.7 m hole less 8 m trims), its kicker 1.6 m over 16 m on a 2 m-sampled road |

- **The repair platforms.** A synthetic leave about 620 m onto the bridge (a 20 degree turn, a 150 m
  straight) and a synthetic join where the bridges close to about 20 m near Little Duck Key (a 6
  degree turn, a 150 m straight). Each straight carries a static ramp truck (no slot: always there)
  and a 30 m `gap` just past its front, the "ramp trucks on repair platforms hop about 30 m between
  the bridges" of round 3. The west one passes the jump lint, so the old road needs no land merge.
- **The turn-off's split zone** is the outer edge of the shoulder (d 4.95 to 8 on a road whose edge
  is 5.5 m out): a rider who keeps right to the rail takes the old road, while the AI's and the dev
  bot's own lines (0.7 and 0.6 m inside the edge) never aim into it. A zone over the travel lane
  swept a rival who was only passing a car onto the old road.
- **The kicker's size** comes from the sim, not the vacuum figures: `tools/gis/routes-keys-pt3.test.ts`
  rides every bike in the packs over it. At 1.6 m the slowest lip speed that clears is 39.1 to 39.7
  m/s for every bike; the Rustbucket flat out (44.4 m/s at the lip) lands 11.5 m past the far edge,
  and a rider at 85 % of its top speed misses and wakes on the highway (`respawn: "main"`). At the
  critic's 2.0 m the threshold was 35.1 to 35.7 m/s, which a rider well under top speed cleared.

## Fetch once, bake offline

- **One Overpass query** for every US 1 way in the Keys, with tags and geometry
  (`out tags geom`), sent with a User-Agent that names the project, as the
  [Overpass API](https://wiki.openstreetmap.org/wiki/Overpass_API) usage policy asks.
- **One USGS 3DEP request** (`getSamples` on the 3DEP elevation image service) for the land
  elevation along the stretch.
- Both raw responses are cached under `tools/gis/.cache/` (git-ignored) with a sidecar
  `.meta.json` holding the query, the retrieval time and the SHA-256. A cached response is never
  fetched again, and every baked file cites those values in `provenance.sources`. A re-bake on a
  fresh machine fetches once more, so its hashes (and possibly its roads) change with the data.

## The pipeline

1. **Stitch.** The ways become a directed graph (one-way carriageways forward only), and the
   shortest drivable path between two nodes is the travel line. On divided stretches that is the
   carriageway for the direction of travel.
2. **Clip, smooth, compress.** The stretch is clipped between two points, the heading along it is
   Gaussian-smoothed (OSM draws long bridges as a few straight segments), long straights are
   shortened (bridges keep their real length), and positions are re-integrated from the heading,
   so the stored curvature and the positions agree by construction.
3. **Elevation.** Land comes from 3DEP, low-pass filtered and floored above the water (world
   `y = 0`). 3DEP is bare earth, so it reads the water under a bridge; bridge decks and their
   humps are **synthesized** from the config, not measured.
4. **Emit.** One network with pass-through junctions, one road per land stretch or long bridge
   (with a rail along both sides of every bridge), and one route over the whole stretch. The bake
   runs its own copy of the documented road lint before it writes anything.

## The frame

Transverse Mercator on WGS84, central meridian and origin at the network's `crs` origin, scale
factor 1 (the [one world coordinate system](../../docs/architecture.md#one-world-coordinate-system)).
World `x` is east, `y` up, `z` south. The Keys networks share the hand-made network's origin
(24.7, -81.1), so the two line up in one frame. `tests/test_tmerc.py` checks the projection
against PROJ to a millimetre.

## Licences and credit

- OpenStreetMap data is © OpenStreetMap contributors, under the
  [Open Database License 1.0](https://www.openstreetmap.org/copyright). OSM-derived pack files
  carry an `osm-` prefix, which the pack manifest's `licenseRules` put under ODbL with that
  attribution. Every pack that holds them (`base`, `region-pnw`, `region-sf`) carries the rule and
  its own copy of the licence text (`LICENSES/ODbL-1.0.txt`). This script is published as the
  preprocessing code.
- USGS 3DEP elevation is public domain; the requested credit is "Map services and data available
  from U.S. Geological Survey, National Geospatial Program."
