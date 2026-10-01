# tools/gis/staging: real roads for the new regions, baked early

The maintainer moved the next regions forward: "Pnw and sf first then others" (playtest 1c,
2026-09-30). While another lane builds those region packs, this folder holds four real stretches
baked from public data in exactly the pack's road format, so each can land as an alternative route
the day its region pack exists. Nothing here is in the game: the base pack only reads
`packs/base/`. [default]

`tools/gis/staging.test.ts` (in the unit tier) drops every file here into a copy of the base pack,
next to a stand-in region file, and runs the real `packs:check` on it: the schema, references,
licence rules and the road lint hook. A bot race on each route runs on demand with
`GIS_STAGING_RACES=1`.

## Licence and credits

These files are derived from OpenStreetMap and are **not** under the repo's MIT licence.

- Road data © OpenStreetMap contributors, available under the
  [Open Database License 1.0](https://www.openstreetmap.org/copyright). The licence text is in
  `packs/base/LICENSES/ODbL-1.0.txt`. Every file carries an `osm-` prefix, which the base pack's
  `licenseRules` put under ODbL with that attribution once the file is in a region folder.
- Land elevation from USGS 3DEP, public domain: "Map services and data available from U.S.
  Geological Survey, National Geospatial Program."
- The preprocessing code is published beside them: `tools/gis` (configs in `tools/gis/configs/`).
- Every network, road and route records its sources, the exact query, the retrieval time and the
  SHA-256 of what was read, in `provenance` (`meta.provenance` on routes).

## What is here

| Region (folder) | Network | Roads | Route |
|---|---|---|---|
| `pacific-northwest` | `osm-pnw-chuckanut`: Chuckanut Drive (WA SR 11), southbound from above Larrabee State Park | `osm-chuckanut-larrabee`, `osm-chuckanut-cliffs`, `osm-chuckanut-oyster-creek` | `osm-chuckanut-run` |
| `pacific-northwest` | `osm-pnw-gorge`: the Historic Columbia River Highway, eastbound from the Women's Forum viewpoint down past Crown Point, Latourell and Shepperd's Dell | `osm-gorge-crown-point-loops`, `osm-gorge-latourell`, `osm-gorge-shepperds-dell` | `osm-gorge-run` |
| `san-francisco` | `osm-sf-russian-hill`: Hyde over Russian Hill and Nob Hill, California down to Kearny, Columbus, Union back over the hill, then Leavenworth | one road per street: `osm-sf-hyde`, `-california`, `-kearny`, `-columbus`, `-union`, `-leavenworth` | `osm-sf-hills-run` |
| `san-francisco` | `osm-sf-twin-peaks`: Upper Market from Sanchez, Portola, then Twin Peaks Boulevard to the summit | `osm-sf-upper-market`, `osm-sf-portola`, `osm-sf-twin-peaks-climb` | `osm-sf-twin-peaks-run` |

## Fun potential

From `tools/gis/reports/<id>.fun.json`, which the bake writes (`tbgis bake` computes every number).

| Stretch | Length | Corners | Tightest | Turning (deg/km) | Radius < 100 m | Elevation (climb/drop) | Max grade | Steeper than 8% | Launch crests | Junctions | Bridges | Max drift |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `osm-pnw-chuckanut` | 7.62 km, 3 roads | 7 | 40 m | 144 | 3.9% | 25..77 m (+86/-134) | 12.3% (p95 5.5%) | 2% | none | 6 (0.8/km) | 0 m | 19 m |
| `osm-pnw-gorge` | 7.63 km, 3 roads | 30 | 27 m | 392 | 24.1% | 37..236 m (+57/-228) | 12.5% (p95 6.3%) | 2% | none | 4 (0.5/km) | 232 m | 33 m |
| `osm-sf-russian-hill` | 5.35 km, 6 roads | 5 | 16 m | 82 | 3.4% | 10..95 m (+210/-211) | 22.2% (p95 18.1%) | 45% | 1 (from 34.6 m/s) | 62 (11.6/km) | 21 m | 10 m |
| `osm-sf-twin-peaks` | 5.66 km, 3 roads | 23 | 17 m | 363 | 22.9% | 40..260 m (+237/-16) | 8.9% (p95 8.3%) | 14% | none | 31 (5.5/km) | 164 m | 16 m |

How to read it:

- **Corners** are runs tighter than a 150 m radius that turn at least 20°. **Turning** is the total
  heading change per km. For scale, the Keys' US 1 probe found 91% of that road straighter than a
  2 km radius.
- **Launch crests** are where a bike following the road would leave the ground below the starter
  bike's 44.7 m/s top speed (`sqrt(g / c)` for a crest of vertical curvature `c`). That is a physics
  estimate; the game's own airborne rule decides what happens.
- **Junctions** count public roads meeting the route (driveways and parking aisles left out). The
  bake keeps them as pass-through only: the route has no turns there, and no side road is baked.
- **Max drift** is how far the smoothed line strays from the real OSM line. Positions are
  re-integrated from the smoothed heading, so each corner's smoothing shifts what follows a little.
  Fine for racing; it matters only if scenery is ever placed from real-world coordinates.

## What the data showed

- **Chuckanut Drive** is a steady, flowing cliffside road: gentle grades, sweepers more than
  hairpins (seven corners, the tightest 40 m), and almost no junctions. The south end (the Oyster
  Creek section) is the twistiest. No bridges are tagged along it in OSM.
- **The Historic Columbia River Highway** is the twistiest road here: 30 corners, a quarter of it
  tighter than a 100 m radius, and a 200 m descent from the Crown Point viewpoint through the
  famous loops. Its three short bridges (106, 77 and 49 m) get straight decks between their banks.
- **Russian Hill** is the hill route: 45% of it steeper than 8%, real grades to 22%,
  210 m of climbing in 5.35 km, and one crest that would launch a bike from about 77 mph. It also
  crosses a junction every 86 m. The corners are the grid's right angles, smoothed to a 16 m radius.
- **Twin Peaks** is a 220 m climb, 23 corners, finishing at the summit. The through road over the
  top is car-free in OpenStreetMap today, so the route stops there instead of crossing it.
- In the bot's races (dev machine, seed 7, the field without the cop), the bot finished all four:
  Chuckanut in 294.8 s with 1 crash, the Gorge in 308.9 s with 2, Russian Hill in 246.3 s with 1,
  and Twin Peaks in 263.0 s with 3, crossing every road in order with no invalid tick. It never left
  the ground, including on the Russian Hill crest.

## Landing a stretch (once its region pack exists)

The folder names `pacific-northwest` and `san-francisco` are this lane's guesses at the region ids,
and each network has its own frame origin near its stretch (the region packs did not exist when
these were baked). Both are one config edit each.

1. In the stretch's config, delete `outRoot`, set `region` to the region pack's id (if it differs
   from the folder name here) and `crs` to the region's origin, set `networkNotes` to say it is in
   the pack, then run `uv run tbgis bake configs/<id>.json` and `npm run format`. The files land in
   `packs/base/regions/<region>/{networks,roads,routes}/`, where the existing ODbL licence rule
   already covers them. Delete the staged copies in the same PR.
2. Add the network id to the region file's `networks` list (the region lane's file).
3. Add scenery tags once the region's vocabulary exists: the closed tag list is the Keys' today, so
   only `town` is used (on the San Francisco streets).
4. Point an event length at the route (the riders lane's one-line PR), as road-4 did for the Keys.
5. Add a row per region to `THIRD_PARTY_ASSETS.md` (the OSM and USGS rows exist for the Keys).
6. Add the route to a gated bot race, like `tools/gis/osm-route.test.ts` does for the Keys.
