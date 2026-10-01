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
cd ../.. && npm run format                           # match the repo's Prettier style
uv run --directory tools/gis pytest                  # the pipeline tests (plus ruff and mypy)
```

Every bake also writes `reports/<id>.fun.json`: corners, the tightest radius, grades, launch
crests, junctions, bridges, tunnels and how far the smoothed line drifts from the real one
(`src/tbgis/fun.py`).

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
| `region-pnw` | `osm-pnw-gorge` | `osm-gorge-run` (Historic Columbia River Highway): eastbound from the Women's Forum viewpoint through the Crown Point loops to Shepperd's Dell | `osm-gorge-crown-point-loops`, `-latourell`, `-shepperds-dell` |
| `region-sf` | `osm-sf-russian-hill` | `osm-sf-hills-run` (Russian Hill): Hyde over Russian Hill and Nob Hill, California down to Kearny, Columbus, Union back over the hill, then Leavenworth | one road per street: `osm-sf-hyde`, `-california`, `-kearny`, `-columbus`, `-union`, `-leavenworth` |
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
| `osm-sf-russian-hill` | 5.35 km, 6 roads | 5 | 16 m | 82 | 3.4% | 10..95 m (+210/-211) | 22.2% (p95 18.1%) | 45% | 1 (from 34.6 m/s) | 62 (11.6/km) | 21 m | 10 m |
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
