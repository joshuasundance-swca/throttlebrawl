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

A later cell/target overlay can subdivide only one side of a previously noded shared edge. Before
validation, exact collinear T-junctions are subdivided at already-existing physical vertices. This
adds no vertex, moves no coordinate or height, changes no projected coverage, and never snaps a
nearby noncollinear point. New faces share the existing vertex's height; interpolation inside the
subdivided face follows those vertices. Final upward-face, manifold boundary, coverage and shoreline
checks still run unchanged. This is mesh conformity, not source-polygon repair or a boundary waiver.

Fixed-precision normalization and noding move boundaries. An effectively zero-area road-union hole
collapses, while the source island remains dry in the selected topology. Raw source shoreline
equality is not claimed: boundary strips move by less than a millimetre in this selected fixture.
The road/shoulder source retains deliberate 2 cm steps; the tucked collar does not assert an exactly
continuous seam. Some final faces are steep, including millimetre-scale faces near a junction.
Reproducibility and valid geometry are not rideability, visual, phone-performance or hydrological
acceptance. Source hashes and the selected fingerprint keep those reviewed limitations attached to
this particular artifact; changing them requires repeating the geometric and runtime review.

## Explicit elevated decks

The road-band numeric input may additionally contain `elevatedDecks`, an array of upward world-XYZ
triangles with the same shape as `triangles`. Existing `triangles` still own the natural-ground
cutout and collar. Omitted `elevatedDecks` is an empty array and preserves the Eagle geometry
fingerprint. Classifying actual extracted faces belongs to the site's reviewed source extraction;
the recipe does not guess a bridge from height or modify runtime road geometry.

Elevated faces do not cut holes in source ground/water or pull the collar toward their tops.
Ground-owning road/water overlap is still rejected both before and after boundary quantization.
The latter check tests the actual snapped outlines without another snapping overlay that could
erase a thin overlap. Original road/deck evidence must be finite and upward, and remain so after
Float32 rounding; no invalid or collapsed face is discarded or repaired.

Every elevated face must lie entirely inside the bounded source domain and have natural support
coverage beneath its full projected footprint. That coverage is the actual grass/water mesh plus
ground-owning road faces, never the elevated faces themselves. Coverage validation therefore cannot
hide a missing river or ground patch under a bridge. Over every positive-area overlap, the actual
Float32 deck top must be strictly above the natural grass/water face. Exact rational triangle clipping and
plane differences check all overlap vertices, including an intersection hidden by a safe midpoint.
The proof records natural-face and ordinary-road overlap counts separately, and the minimum natural
top separation in metres (null if no natural face overlaps). Existing approach road/deck faces may
meet at grade: they remain the unchanged road layer, and no road/road clearance is asserted. Shared
edges with no overlapping area do not assert a separation.

**Top separation is not surveyed physical clearance.** It does not model deck thickness, undersides,
supports, flood stages or navigable clearance. Approach classification, ground/deck transitions,
terrain grades, source datum reconciliation, scenery contacts, race progress and rendered behavior
still require site-specific review. No site-specific classification, water level, collar width or
physical-clearance threshold is chosen by this optional input.

## Desired natural-ground planes

The road-band input may also contain `groundGrades`, an array of upward world-XYZ triangles with
the same shape as `triangles`. A guide specifies a desired natural-ground plane; it is not a road,
deck or terrain cutout. Omission preserves the selected Eagle fingerprint. Choosing guide footprints
and heights belongs to reviewed site extraction, including the actual feet, aprons and people that
need support. This input chooses no site constants or water levels and does not modify the source DEM.

Roads and guides share the existing nearest-control transition machinery: a 39.99 m buffer whose
final arrangement stays within the conservative 40 m offset. The nearest actual control-boundary
plane receives the existing 0.06 m tuck for a road and zero tuck for a guide. Final transition-boundary
and outside-owned nodes keep their original DEM heights. Inside a guide's declared STEP-snapped
footprint, nodes use that guide's actual Float32 plane directly, including snapped boundary nodes
that lie just outside the original footprint. Heights are rounded to Float32; sloped-face interpolation
therefore retains that physical precision. The globally noded arrangement includes every guide edge.
Guide footprints undergo the same declared precision operations as other arrangement inputs; exact
equality with an original apron or other unsnapped footprint is not promised. Site review must examine
the resulting footprint displacement and support at its edges as well as its interior.

Every guide must be finite, upward and noncollapsed before and after Float32 rounding, retain a
nonempty STEP-snapped footprint, and fit inside the bounded source domain. Positive-area overlap
with a road, elevated deck or source water rejects both before and after quantization. Guide planes
must agree throughout their overlap and at shared nodes or edges, checked with exact rational plane
heights on both original and snapped intersections; inconsistent shared heights reject rather than
silently choosing the higher plane. Consistent coplanar guide overlaps are allowed. The recipe does
not repair source geometry or remove water to make a guide fit.

Only ground-owning road faces determine the inward terrain cutout. Grades remain grass, and the
unchanged world-coverage, manifold-boundary, shoreline, deck-support and identified-body checks still
apply. A guide cannot count as support for a missing terrain patch. Guides can change the noded mesh
and its tessellation without changing source water outlines, holes, proxy levels or road/deck faces;
identified-body proof continues to compare output with the independently reconstructed arrangement.
Geometry validation is not rendered, pedestrian, rider, survey or phone acceptance.

## Identified water bodies

The exact legacy manifest keys `{road_band, grid, river, water_samples}` retain the original single
water-median mode and Eagle geometry fingerprint. A second, mutually exclusive mode uses exactly
`{road_band, grid, water_bodies}`. Mixed or partial input sets are rejected. Both modes retain hashed
numeric files, pinned authoring versions and selected output fingerprints.

The `water_bodies` file has this shape (numbers here are synthetic examples, not site data):

```json
{
  "formatVersion": 1,
  "bodies": [
    {
      "id": "source-feature-id",
      "polygons": [[[[0, 0], [10, 0], [10, 10], [0, 10]]]],
      "elevations": [1, 2, 3],
      "provenance": {"source": "capture record and observation method"}
    }
  ]
}
```

Each polygon is an outer ring followed by any holes, in network X/Z metres. IDs must be unique;
geometry must be nonempty and valid; observations must be nonempty and finite. Bodies with
positive-area overlap are ambiguous ownership and rejected, including overlap introduced by
quantization. The authorer never repairs invalid polygons or matches separate geometry/observation
lists by ordinal. Bodies must retain nonempty coverage in the quantized source domain.

Each body receives its own horizontal Float32 median elevation proxy and output water patch labelled
`waterBody`. The output contains geometry, not runtime sampling dependencies. Coverage and shoreline
proof aggregate all water patches. Per-body checks independently reconstruct the declared globally
snap-rounded arrangement from preserved road, grid and water inputs, including the subsequent
cell/target intersections, before comparing that planned polygon coverage exactly to actual output
faces. The planned oracle never comes from unioning the output triangles themselves. Body labels,
proxy levels and source holes remain checked; source holes and planned holes must correspond one to
one by overlap. Raw or merely pre-noding snapped shoreline equality is not claimed: new grid/cell
intersections also undergo the declared precision operation. The keyed proof reports source-to-plan
missing/extra areas and boundary Hausdorff displacement, without a fitted tolerance or automatic
acceptance allowance. It also preserves source observation count, minimum/maximum/median, supplied
provenance, source-body hash and output geometry hash. Selecting changed source transformations or a
new geometry fingerprint still requires review; a passing proof does not select its own artifact.
Omitted body labels are not serialized into legacy output.

These are explicitly approximate game surfaces. A median proxy does not establish a measured stage,
hydraulic continuity, canal slope, flood model, current conditions or surveyed datum/clearance. The
source spread and provenance stay in the proof so site review can decide whether a horizontal proxy
is appropriate. This API chooses no source observations, feature segmentation or physical constants.

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
