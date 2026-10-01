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
uv run tbgis bake configs/osm-pnw-gorge.json         # a staging bake -> tools/gis/staging/...
cd ../.. && npm run format                           # match the repo's Prettier style
uv run --directory tools/gis pytest                  # the pipeline tests (plus ruff and mypy)
```

Every bake also writes `reports/<id>.fun.json`: corners, the tightest radius, grades, launch
crests, junctions, bridges, tunnels and how far the smoothed line drifts from the real one
(`src/tbgis/fun.py`).

## Beyond the Keys: street routes and high country

The new regions (Pacific Northwest and San Francisco) needed a few config switches, each off by
default so the Keys bake is unchanged. Their staged bakes and fun report are in
[staging/README.md](staging/README.md).

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
- `outRoot`: where the files go (default: the region's pack folder), for staging bakes.
- `realName`, `waysLabel` and `networkNotes`: the words the Keys bake had built in.
- USGS `getSamples` answers at most 1,000 points per request and silently drops the rest, so longer
  stretches go in batches.

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
  attribution. This script is published as the preprocessing code.
- USGS 3DEP elevation is public domain; the requested credit is "Map services and data available
  from U.S. Geological Survey, National Geospatial Program."
