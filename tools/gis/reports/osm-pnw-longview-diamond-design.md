# Longview street diamond

This separate one-pass course preserves Civic Triangle and Port Shift. Its short
arm turns down 20th Avenue, then Washington Way. Its longer outer arm follows
Olympia Way and the continuous Kessler Boulevard chain. Both reconnect before
Washington's mapped bridge and the shared northbound 30th Avenue finish.

## Source and adaptations

The captured OSM extract is dated 2026-10-15T21:21:54Z, SHA-256
`704f4ef4d0558e238607a3fc5bba1a262766b7faa84677652ccfcda50e67fee1`.
The config keeps its exact query and selects these source paths:

- Approach: Olympia 5882042 from 46.1407113, -122.9397393 to the shared fork
  at 46.1429503, -122.9422477. Separate generated ids represent the approach
  and outer portions of this one OSM way.
- Inner arm: 20th 53057477 to 46.1367281, -122.9446825, then Washington
  5880132 to the shared Kessler rejoin at 46.1343662, -122.9507149.
- Outer arm: Olympia 5882042 to 46.1465608, -122.9463040, then Kessler
  5881972, 1497703017, 1497703016, 1497699461 and 1497699460, traversed
  opposite their stored geometry to the shared Washington rejoin.
- Finish: Washington 1503405166, 129381274, 129381273 and 876117692,
  then 30th 914535557.

The selected streets are asphalt. Olympia and Washington explicitly say
`oneway=no`; the selected 20th and Kessler ways omit a one-way tag. No selected
way has an access tag, and the extract includes no turn-restriction relations.
These are dated authoring inputs, not current legal-access or restriction advice.

Genuine USGS 3DEP samples were acquired on 2026-10-16. Inner: 331 finite
samples, captured 11:43:46Z, SHA-256
`67cdd224b3e9773347960da9800b19d01e95a7a590ccc5b4ab1a6c63bb66bdff`.
Outer: 202 finite samples, captured 11:43:47Z, SHA-256
`410de5edcf26c9536e505f32ff92ce2365ef7ddfb7a8228b2ef3d790e4b5d78b`.
The sample-point hashes and response hashes are retained in baked provenance;
the ignored source caches retain their original metadata sidecars. No zero-height
substitution was used. Regenerate with
`tbgis network tools/gis/networks/osm-pnw-longview-diamond.json` from the repo root, then format
the generated JSON.

The source geometry is adapted with 4 m drive lanes in each direction, 6 m soft
grass verges on ordinary streets, 28 m heading smoothing, and synthetic eased
junction movements. A 100 m main fork piece and 110 m outer entry inset leave
room for a deliberate right-side choice outside the ordinary lane centre. The
60 m main rejoin piece and 220 m Kessler inset keep the existing 42.5 m minimum
connector radius while preserving the mapped bridge as a separate protected road.
Only that bridge has the wall/guardrail treatment; ordinary grass remains soft.
Generic town dressing and a far-ground floor claim no surveyed property,
landmark, lake or park geometry. There is no nested Hudson branch or boost pad.

## Baked result and automated acceptance

The generated report measures the inner fork-to-rejoin path at 1250.9 m and the
outer path at 1976.7 m, about 726 m longer. The main race is 3219.6 m. These are
baked path distances, not measured rider times or a promise of time parity.

- The picker offers this course independently and retains the two existing
  Longview choices. The grid fits before the marked fork; both arms reconnect
  before the reachable finish, with coherent checkpoints and progress.
- An isolated Rental Moped rides either complete path using input commands only,
  reaches the shared finish without a crash and replays to the same hashes.
- Input commands ride from the actual grid onto the supported grass margin and
  back onto the lane, without placing or moving sim state to force success.
- Content-derived branch drive-lane cohorts have direction-valid continuations
  and finite exits. Natural vehicles move in both directions on both arms within
  the existing shared population allowance.
- Geometry probes examine rendered connector-lane footprints, soft street
  recovery ground and the authored walking zone. A missing-ground negative
  control still returns no hit. Existing cliff/water controls are unchanged.
- Source provenance and independent generated road ids are checked. No runtime,
  format, economy, budget or CI changes are needed.

The scoped geometry construction produced 39406 triangles and 107 meshes over
the complete unculled road network using the flat look and seed 1 on the dev
machine. This is not a rendered-view draw-call, performance or budget verdict.
The coordinator owns the served build, camera-cost checks, CI and live check.
Phone verification remains pending.
