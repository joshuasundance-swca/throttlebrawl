# Offline Eagle terrain recipe

This standalone authoring tool reproduces the selected Eagle terrain from small, preserved numeric
inputs. The game does not import Python, NumPy, Shapely or GEOS. Like Blender, this is an external
authoring requirement; it does not change the GIS project's or game's dependency configuration.

## Authoring environment

Use Python 3.12 or newer with the exact versions recorded in `eagle-point/manifest.json`:

- Shapely 2.2.0, linked to GEOS 3.14.1;
- NumPy 2.5.3;
- Pydantic 2.13.5.

Prepare that separate environment from approved local wheels if working offline. The script checks
all four versions and refuses a mismatch. It makes no network request and installs nothing. It can
also use an already provisioned isolated Shapely directory through `PYTHONPATH`; the chosen Python
must still provide the pinned NumPy and Pydantic. No runtime package or GIS lockfile change is needed.

From the repository root, with `python` referring to that authoring interpreter:

```sh
python tools/gis/terrain/recipe.py \
  --manifest tools/gis/terrain/eagle-point/manifest.json \
  --output scratch/eagle-terrain.json \
  --proof-output scratch/eagle-terrain-proof.json
```

All three paths are explicit. The output is a terrain object containing `patches`; integration into
a network remains a separate reviewed action. The script checks input hashes, data shape, finite
heights, source geometry, final upward Float32 faces, edge topology, actual world coverage, the
selected geometry fingerprint, and decimal serialization before creating or replacing any output.
Each file replacement is atomic; replacing the mesh/proof pair is not a two-file transaction.
An output cannot replace a preserved input or the other output.

The fingerprint hashes ordered surface names and counts, followed by little-endian Float32 XYZ and
unsigned 32-bit triangle indices. It therefore compares physical geometry independently of decimal
spelling. Regeneration must match `expected_geometry_sha256` in the manifest.
Regeneration has been demonstrated in the current authoring environment. Pinned versions and the
expected fingerprint fail closed on ordered Float32 vertex or index divergence; they do not
guarantee identical output across platforms. The original selected
JSON byte hash is retained separately in provenance. Output decimals use the first 1 through 9
significant digits that preserve each Float32 value. **Round decoded coordinates to Float32 before
physical use.** The road-band input is likewise restored to Float32 before any GEOS operation or
plane evaluation. DEM and river inputs retain their original double-precision values.

## Preserved inputs and provenance

`eagle-point/` contains only what regeneration needs:

- `road-band.json`: world XYZ for actual upward rendered `road-road` and `road-shoulder` triangles;
- `grid.json`: original X/Z axes and row-major DEM heights;
- `river.json`: locally projected polygon rings, including source holes;
- `water-samples.json`: the prior interior-water DEM observations used for the median;
- `manifest.json`: hashes of those files, original artifact hashes, the renderer/pack source hashes,
  coordinate frame, source credits, authoring versions and selected physical geometry fingerprint.

The renderer/pack hashes identify the extraction source bytes loaded from the then-active integration
worktree, not the recipe commit tree; no committed revision is asserted. The river retrieval record
preserves the Overpass endpoint, exact query, retrieval time and raw-response hash/byte count.
Its repeated relation sequence follows polygon origins; distinct relation IDs are recorded separately.

No complete HTTP response, redundant rendered-scene diagnostic, or previous proof history is
required. The minimal road-band fixture is intentionally not a general mesh exporter. Recreating it
from changed renderer/road data requires a fresh source extraction and review; this recipe does not
claim the frozen triangles track future renderer edits automatically. Updating inputs or the
selected fingerprint requires source review, not accepting whatever a new bake happens to emit.

World metres use X east, Y up at source elevation, and Z south, in the network's Transverse Mercator
frame on WGS84. The manifest records its origin. Elevation is a coarse USGS DEM, not a surveyed road
contact surface. The water height is the median of prior interior-water DEM samples; it is **not a
current river stage, flood model or datum validation**. Preserved source elevation is not replaced
with synthetic elevation. Output grass in the road collar is an authored blend/tuck, and the
horizontal water surface is a DEM-median proxy rather than a measured water level.

Road and river geometry derives from OpenStreetMap, © OpenStreetMap contributors, under
[ODbL-1.0](https://www.openstreetmap.org/copyright); the region pack carries
[the licence](../../../packs/region-clinton/LICENSES/ODbL-1.0.txt). Elevation derives from public-domain
USGS 3DEP data: “Map services and data available from U.S. Geological Survey, National Geospatial
Program.” Source URLs, query/retrieval details when preserved, and upstream hashes are in the
manifest. Processing was AI-assisted. These source-derived fixtures are not original surveyed data.

## Selected algorithm and limits

The recipe preserves actual road/shoulder top faces and uses a shared binary precision grid of
2^-10 metre. It clips source river coverage to the DEM rectangle and constructs grass outside an
inward 0.02 m road offset. The resulting deliberate road/terrain overlap hides quantified XZ
displacement. A globally noded arrangement includes DEM diagonals and road, collar, transition and
water boundaries; constrained Delaunay creates authored triangles offline. Source holes remain
absent from water by geometry, not by classifying DEM cell centres.

Each canonical grass node begins on its original DEM triangle plane. Inside the final noded
transition, it blends toward the highest actual nearest road-boundary plane minus a 0.06 m tuck.
The transition uses a 39.99 m buffer and lies within a conservative 40 m offset. All final boundary
and outside-owned nodes have zero blend. Adjacent arrangement cells share nodes. Water has explicit
triangles and a horizontal DEM-median height.

Fixed-precision normalization and noding move boundaries. An effectively zero-area road-union hole
collapses, while the source island remains dry in the selected topology. Raw source shoreline
equality is not claimed: boundary strips move by less than a millimetre in this selected fixture.
The road/shoulder source retains deliberate 2 cm steps; the tucked collar does not assert an exactly
continuous seam. Some final faces are steep, including millimetre-scale faces near a junction.
Reproducibility and valid geometry are not rideability, visual, phone-performance or hydrological
acceptance. Source hashes and the selected fingerprint keep those reviewed limitations attached to
this particular artifact; changing them requires repeating the geometric and runtime review.

## Focused checks

Use the same authoring interpreter and the GIS project's existing dev tools:

```sh
python -m pytest tools/gis/terrain/test_recipe.py --basetemp scratch/pytest-terrain
python -m ruff check tools/gis/terrain
python -m ruff format --check tools/gis/terrain
python -m mypy --config-file tools/gis/pyproject.toml tools/gis/terrain
```

The tests regenerate the selected geometry, round-trip every resulting vertex through shortened
JSON, check representative Float32 edge values/nonfinite values, reject collapsed geometry and DEM no-data, and
confirm validation failure preserves existing outputs. They do not need a browser or application
build. Shapely's pinned distribution has no typing metadata; its geometry objects are the explicit
untyped boundary in an otherwise strictly checked Python module.
