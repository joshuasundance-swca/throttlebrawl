# tools/blender: the scripted model pipeline

Python scripts build each 3D model in headless Blender, from an empty scene, and export one GLB. The GLBs are committed to their pack under `packs/<pack>/assets/models/` (the base pack unless the catalog row names another), because CI has no Blender. CI checks the committed files instead: `tools/blender/models.test.ts` runs in `npm test`.

The pipeline was approved after the 2026-09-30 blind prop trial (playtest 1c, item 4, 2026-09-30: "We can start"). It is that trial's harness, ported. The truck, the palms and the boat are the trial models the maintainer picked; the scenery pack is new. The region build-out (W-O, the maintainer, 2026-10-01: "better visuals and experience") adds the Pacific Northwest's conifers, sawmill and trestle bents and San Francisco's row houses, cable car and fog banks.

Status `[default]`: every model is "done, not phone-verified". The renders are Blender EEVEE renders, not in-game frames.

## What you need

- **Blender 5.2 LTS.** Set `BLENDER_EXE` to the `blender` executable. Without it, every command below prints a note and exits 0, so the npm scripts skip cleanly on machines without Blender, CI included.
- **Node 22.** The repo already requires it. `score.mjs` has no dependencies.
- **Optional: Python with Pillow** (`PYTHON`, default `python`). It draws the contact sheet; without it the sheet is skipped with a note.
- **Optional: the npm registry** for `--validate` (it runs `npx @gltf-transform/cli@4.5.1 validate`, the Khronos validator).

## Commands

| npm script | Same as | What it does |
| --- | --- | --- |
| `npm run asset:build [-- <prop> ...]` | `node tools/blender/build.mjs` | Builds each prop twice, checks the two GLBs are byte-identical, scores the first, and writes it to `packs/<pack>/assets/<asset>.glb` if it changed. Logs go to `.cache/blender/build/`. |
| `npm run asset:check` | `node tools/blender/build.mjs --check` | Rebuilds into `.cache` only and checks that each rebuild is byte-identical to the committed GLB. Run it after changing a script, to prove the commit matches its source. |
| `npm run asset:render [-- <prop> ...]` | `node tools/blender/render.mjs` | Renders each committed GLB from 3 cameras into `.cache/blender/renders/`, and makes `contact-sheet.png` there. `--engine workbench` gives a quick preview. |
| `npm run asset:score [-- <prop> ...]` | `node tools/blender/score.mjs` | Scores the committed GLBs (no Blender needed). `--json` prints everything; `--validate` adds the Khronos validator; `--glb <file> --prop <name>` scores a GLB from elsewhere. |

Every command prints an `[examined]` line with what it looked at. A build fails (exit 1) if Blender fails, if the two builds differ, or if a score check fails. `--check` also fails when a rebuild differs from the committed file.

## Files

| File | Role |
| --- | --- |
| `catalog.mjs` | The roles, the camera views and the helpers, and `PROPS`: one row per model (its script, asset id, pack, kind, budgets, camera views and node contract). Everything else reads it. |
| `catalog/*.mjs` | The rows, one file per batch (playtest 3, C0a): `base.mjs` holds every row made before the split, `traffic.mjs` the shared traffic kit (base pack, no region), `keys.mjs` the Keys' own (base pack, `region: 'florida-keys'`), `sf.mjs` San Francisco's (`region-sf`) and `pnw.mjs` the Pacific Northwest's (`region-pnw`). A batch appends to its own file only, so two batches never edit the same rows. |
| `props/*.py` | One Blender script per model. `tow_truck.py`, `boat.py` and `palms.py` are the trial scripts and stand alone. The scenery scripts share `props/_lib.py`. |
| `build.mjs`, `render.mjs`, `blender.mjs` | Run Blender (from `BLENDER_EXE`) headless. |
| `render.py`, `sheet.py` | The camera rig, run inside Blender, and the contact sheet (Pillow). |
| `score.mjs` | Budgets and geometry checks on a GLB, in plain Node. |
| `models.test.ts` | The CI gate on the committed GLBs (see below). |
| `ruff.toml` | The Blender Python is linted with ruff only: `ruff check tools/blender`. |

## Optimiser

`build.mjs` runs the dependency-free Node optimiser on both exports before comparing or scoring
them. `optimize.mjs` drops `NORMAL` unless a row sets `keepNormals: true`, welds identical complete
vertex tuples, shares vertex accessors across each mesh's material primitives, and packs one
index view and one view per attribute kind with 4-byte alignment. Meshes below 65,536 vertices
keep uint16 indices. POSITION bounds are recomputed from the stored floats. Roughness factors
are removed; material roles, base colours, metallic zero, nodes, extras and scene hierarchy stay
intact. Each export prints its original and optimised byte lengths. Re-optimising is byte-identical.

The pre-export winding guard independently recalculates closed components' outward polygon
normals, checks Blender's tessellated triangles against those references, and reverses opposing
triangles without moving vertices or changing their diagonals, UVs or sway. Open panels retain
their explicitly authored front. A vehicle cabin keeps its side panes' corners inside its sloped
pillars (`_vehicle_lib.cabin`), so a shallow windscreen never folds the frame facets over each other. `WINDING_AUDIT` in each build log records before/after counts.

## The models

The numbers are measured on the committed GLBs (`npm run asset:score`). "Draws" are derived, not measured. One draw is one primitive of each unique mesh, because meshes shared by several nodes, or placed many times, can be instanced. "Merged" is the floor if the game merges a static prop by material.

| Asset id | Nodes the game uses | Tris | Draws (merged) | Notes |
| --- | --- | --- | --- | --- |
| `models/props/tow-truck` | `tow_truck` root at the ramp foot; `ramp_surface` (extras `ramp_angle_deg`, `ramp_run_m`, `ramp_lip_height_m`), `cab`, `trailer`, `car_1`, `car_2`, `wheel_1` to `wheel_10` (one shared mesh) | 2012 | 16 (9) | The trial pick B. The ramp is 13.7°, with an 11.5 m run and a 2.8 m lip, matching the `rampTruck` feature's defaults. |
| `models/props/boat` | `boat` root = waterline pivot; `hull`, `console`, `outboard`; `probe_bow`, `probe_stern`, `probe_port`, `probe_starboard` at y = 0 | 850 | 8 (6) | Claude's trial hull, with the rods re-made: stubby rods in holders. |
| `models/scenery/palms` | `palm_a`, `palm_b`, `palm_c` at x = −4, 0, +4; each has `_trunk` and `_fronds` | 452 per variant | 3 per variant | The trial pick B. `_SWAY` vertex weight from 0 at the base to 1 at the frond tips. |
| `models/scenery/mangroves` | `mangrove_a`, `mangrove_b` at x = −3, +3; each has `_roots` and `_canopy` | 435 per variant | 3 per variant | Red mangrove clumps on arching prop roots, with `_SWAY` like the palms. |
| `models/scenery/bait-shack` | `bait_shack` root; `bait_shack_body`, `bait_shack_sign` (text surface) | 400 | 4 (4) | A shack on stilts with a tin roof, a porch, an ice chest and a blank rooftop sign. |
| `models/scenery/power-pole` | `power_pole` root (extra `wire_attach_count`); `power_pole_body`; `wire_attach_1` to `_3` | 116 | 2 (2) | Wires run along the pole's local Z. The attach empties are the insulator tips, left to right in X. |
| `models/scenery/skiff` | `skiff` root = waterline pivot; `skiff_hull`, `skiff_gear`; the same 4 probes as the boat | 210 | 3 (3) | The small offshore boat: a flats skiff with a poling platform. It is cheaper than the boat, for use in numbers. |
| `models/scenery/road-signs` | `sign_a` (green highway blank on posts) and `sign_b` (plywood board on stakes) at x = −2.5, +2.5; `sign_a_face`, `sign_b_face` (text surfaces), `sign_a_posts`, `sign_b_stakes` | 36 per variant | 2 per variant | The game draws the sign text. |
| `models/scenery/conifers` | `conifer_a` to `conifer_d` at x = −9, −3, +3, +9; each has `_trunk` and `_boughs` | 76, 64, 46, 76 | 3 per variant | Pacific Northwest firs (21, 14 and 7.5 m) and a droopier cedar (16.5 m): stacked faceted cones in two greens. No sway. |
| `models/scenery/row-houses` | `row_house_a` to `row_house_d` at x = −10.5, −3.5, +3.5, +10.5; each has `_body`. The root is the middle of the front wall at the sidewalk | 180, 182, 140, 132 | 6 per variant | San Francisco Victorians: Italianate (pink), Queen Anne with a turret (mint), Stick (yellow), Edwardian (blue), each with a painted stoop and white handrails. Each paint is its own role (`paint_pink` and so on), so a region palette repaints it. |
| `models/props/cable-car` | `cable_car` root at the car's middle on the road; `cable_car_body` | 492 | 8 (8) | An open-ended grip car, 8.5 m by 2.6 m: the region's cable-car traffic. |
| `models/scenery/sawmill` | `sawmill` root at the yard's front edge; `sawmill_body` | 488 | 6 (6) | A mill shed, a teepee burner with a conveyor, a smokestack, logs and lumber. About 32 m by 17 m. |
| `models/scenery/trestle-bent` | `trestle_bent` root on the ground under the deck's middle; `trestle_bent_body` | 132 | 2 (2) | One timber bent, 10 m tall as authored; the game stretches it to each deck and repeats it along a forest region's bridges. |
| `models/scenery/fog-banks` | `fog_bank_a`, `fog_bank_b` at x = −40, +40; each has `_body` | 280, 200 | 1 per variant | Low banks of faceted domes in one `fog` role; the game draws them unlit in the region's fog colour, offshore. |
| `models/scenery/keys-islets` | `keys_islet_shack`, `keys_islet_wreck`, `keys_islet_mangrove`, `keys_islet_stilts` at x = −60, −20, +20, +60; each has `_body`. The root is the islet's lowest point, 0.8 m under its waterline | 178, 100, 304, 110 (692 in all, 16,940 bytes) | 6 to 8 per variant | Run W-Q's little islands off every Keys bridge (interview, 2026-10-02: distinct keys; playtest 2: "Maybe islands in the Keys"): a sandbar with two palms, a bait shack on stilts and a skiff; a sandbar with a palm and a sailboat aground; a mangrove clump on its roots with a dock and a pelican; a stilt house in the flats. The game sinks each 0.8 m (`scenery.ts` `ISLET_SINK_M`) and instances them like the boats, one islet kind per 256 m square. Shipped without normals. |
| `models/scenery/pnw-roadside` | `pnw_fern`, `pnw_salal`, `pnw_stump`, `pnw_rock`, `pnw_mailbox`, `pnw_firewood`, `pnw_split_rail`, `pnw_log_fence`, `pnw_sign`, `pnw_espresso`, `pnw_maple`, `pnw_alder` along x (−40 to +46); each has `_body` | 24, 24, 38, 16, 88, 78, 60, 60, 42, 196, 94, 56 | 1 to 6 per variant | Run W-P's Pacific Northwest roadside kit: the clutter the game scatters close to the road (roadside.ts) and merges per stretch of road, so its draws do not add up per prop. Fern fronds are double-sided leaves; a fence section is 6 m long along x, laid in runs; the espresso hut faces its service window to the road. |
| `models/scenery/sf-roadside` | `sf_sedan`, `sf_hatch`, `sf_robotaxi`, `sf_tree`, `sf_hydrant`, `sf_scooter`, `sf_board_ai`, `sf_board_agi`, `sf_board_gpu`, `sf_store`, `sf_meter`, `sf_bins`, `sf_lamp` along x (−36 to +21); each has `_body` | 78, 52, 144, 52, 54, 60, 98, 112, 116, 242, about 30, about 70, about 40 | 1 to 9 per variant | Run W-P's San Francisco roadside kit, merged per stretch of road like the Pacific Northwest's. Cars face the road (parked nose to the kerb); the boards' and the store's words are block letters drawn in the script (a 3 by 5 grid, no font). Shipped without normals. |
| `models/scenery/keys-roadside` | `keys_seagrape`, `keys_seagrape_tree`, `keys_traps`, `keys_pelican`, `keys_trailer`, `keys_cottage_a`, `keys_cottage_b`, `keys_picket`, `keys_mailbox`, `keys_bait`, `keys_pie`, then (run W-Q) `keys_shrimp_boat`, `keys_fish_house`, `keys_buoy_line`, `keys_hotel_a`, `keys_hotel_b`, `keys_pool`, `keys_tiki`, `keys_scooters`, `keys_boat_stack`, `keys_bus_stack`, `keys_junk_art`, `keys_bunting`, `keys_coolers`, `keys_closed_bar`, `keys_flamingo` along x (−40 to +222); each has `_body` | 32, 52, 112, 60, 72, 166, 166, about 40, 52, 116, 164; then 154, 160, 176, 202, 202, 100, 186, 362, 120, 56, 174, 60, 128, 170, 88 (3367 in all, 79,528 bytes) | 1 to 10 per variant | Run W-P's Florida Keys roadside kit, merged per stretch of road. A picket section is 4 m along x of flat pointed panels facing the road; cottages stand on short piers with their porch to the road. Run W-Q (interview, 2026-10-02: "distinct keys") adds each key's own props, which the game stands only on that key's stretches: the fishing village's shrimp boat, fish house and buoy line; the resort strip's two hotels (11.7 m tall), pool, tiki bar and scooters; the junkyard key's boat rack, bus stack and junk-art robot; the party key's bunting (a 6 m run), coolers, closed bar and flamingo. The block letters come from `_lib.block_word` (a 3 by 5 grid, no font); the script adds the letters D, F, H, L, N, O and S to the grid for its own boards. Shipped without normals. |
| `models/scenery/sf-downtown` | `dt_tower_glass`, `dt_tower_stone`, `dt_tower_screen_agi`, `dt_tower_screen_series`, `dt_tower_crown`, `dt_hq`, `dt_midrise`, `dt_lamp`, `dt_signal`, `dt_planter`, `dt_bench`, `dt_orb` along x (−150 to +97); each has `_body`. A building's root is the middle of its front wall at the sidewalk | 92, 134, 190, 168, 140, 218, 62, 48, 68, 52, 48, 32 (1238 in all, 36,384 bytes) | 1 to 9 per variant | Run W-R's San Francisco downtown (interview, 2026-10-02: "SF first = downtown towers"): towers 52 to 86 m tall that the game stretches in height and merges per stretch of road (`src/render/downtown.ts`), two with giant screens and one deadpan headquarters, whose words are `_lib.block_word` letters standing 15 cm proud of their faces so they never flicker at a distance; window bands stand 10 cm proud for the same reason. The signal's mast arm reaches 9 m to its right (−X) over the lanes. Shipped without normals. |
| `models/traffic/sedan` | `vehicle`, `vehicle_body`, `hood`, four lamp empties | 304 | 6 | Three-box four-door, 0.95 m flat launch hood. |
| `models/traffic/hatchback` | `vehicle`, `vehicle_body`, `hood`, four lamp empties | 304 | 6 | Short five-door with a steep tailgate. |
| `models/traffic/pickup` | `vehicle`, `vehicle_body`, `hood`, four lamp empties | 352 | 6 | Crew cab, recessed open bed, walls and tailgate. |
| `models/traffic/suv` | `vehicle`, `vehicle_body`, `hood`, four lamp empties | 328 | 6 | Boxy cabin with two roof rails. |
| `models/traffic/minivan` | `vehicle`, `vehicle_body`, `hood`, four lamp empties | 308 | 6 | One-box cabin and sliding-door seam. |
| `models/traffic/box-truck` | `vehicle`, `vehicle_body`, `hood`, four lamp empties, `side_panel` | 318 | 7 | Cab and tall box; +X side_panel for signage; hood marker on front bumper top. |
| `models/traffic/city-bus` | `vehicle`, `vehicle_body`, `hood`, four lamp empties, `side_panel` | 334 | 8 | Flat front, large windscreen, dark paint_secondary stripe; +X side_panel; hood marker on front bumper top. |
| `models/traffic/semi` | `vehicle`, `vehicle_body`, `hood`, four lamp empties | 528 | 6 | Tractor with a roof fairing and a plain trailer, four baked axles. |
| `models/props/ramp-trailer` | `ramp_trailer`, `ramp_surface`, `trailer`, `wheel_1` to `wheel_4` | 384 | 5 | Detached hauler, landing gear and continuous 11.5 m ramp to a 2.8 m lip; same ramp geometry checks as the tow truck. |

Shared traffic has one body mesh per type, with wheels baked in. Native GLB draws above count role material primitives, plus the separate sign where present. The game's colour bake can merge the body roles into one instanced geometry; runtime traffic adoption and its measured draw count are outside this asset-only change. Side panels carry `facing_axis: "x"`; viewed from +X, UV top-left is max Z/max Y and bottom-right is min Z/min Y.

**Phone budget.** The target phone holds 60 fps at about 50 draws and 50k triangles for the whole scene: road, riders, traffic, water and scenery. All six scenery GLBs on screen together cost 28 instanced draws, and 19 if each is merged by material. So a chunk should show a few kinds of scenery at a time, or the renderer should merge static scenery per material. Triangles are cheap by comparison. For example, 40 palms, 12 mangroves, 10 poles, 6 signs, a shack and 3 skiffs come to about 25.7k triangles (scripted from the table above).

## Conventions (every model)

- **Axes.** Each model is authored Z up in Blender and exported as glTF +Y up. The front (the truck's cab, the boat's bow, a sign's face, the shack's porch) faces glTF **+Z**. The prop's left (port, the driver's side) is **+X**. 1 unit is 1 m, and every node has scale 1.
- **Origin.** The origin is the ground (y = 0) under the prop's anchor, as named in the table: the truck's ramp foot, the boats' waterline, each variant's base.
- **Names.** Node, mesh and material names are snake_case and unique within a GLB.
- **Flat colours by role.** Each material is a Principled BSDF with a base colour and nothing else: metallic 0, no textures, no vertex colours, no emission, opaque. A material's name is its **role** (the list is in `catalog.mjs`), so every look can recolour by role. Only the leaf roles (`foliage`, `foliage_dark`) are double-sided.
- **Faceted normals.** No smooth shading. Every catalog model ships **without normals** after optimisation unless its row sets `keepNormals: true`. The game rebuilds face normals from their corners (`models.ts`), and flat Lambert and ink looks derive lighting normals. CX1 checked the seven previously normal-bearing GLBs: none of 5,194 triangles opposed their exported normals by more than 90 degrees. Some polygons are nonplanar, but the earlier claim of 180-degree disagreement does not reproduce on this source revision. The pre-export guard also checks every model against Blender's outward polygon references. Text surfaces are read by winding and remain +Z-facing, except explicitly marked +X vehicle side panels.
- **Deterministic.** Randomness uses a fixed seed and nothing reads the clock, so rebuilds are byte-identical (`asset:check`).
- **Text surfaces.** A text surface is a flat panel facing +Z, a separate node with one material and a UV map. It carries the extras `text_surface: true`, `width_m` and `height_m`. In glTF's UV convention, UV (0, 0) is the panel's top-left corner as seen from the front, and (1, 1) is the bottom-right. The game paints the words into a canvas texture on that node. The score reads the panel's front from its normals when it ships them, and from its winding when it does not (counter-clockwise seen from +Z), so a text surface may drop its normals too. No other mesh has UVs, except atlas surfaces.
- **Outward winding.** Once normals are dropped, a face's front is its winding alone, and the game culls back faces (only the leaf roles are double-sided). Closed parts wind every face outward. A row may list closed convex parts in `convexParts`; the score then checks that every face of each points away from the part's centre (`faces_wound_outward`). The optimiser drops normals unless the row says `keepNormals: true`.
- **Pack and region.** A row's `pack` (default `base`) is where its GLB is committed: `packs/<pack>/assets/<asset>.glb`. A region's own models go in its region pack (`region-sf`, `region-pnw`); the Keys' stay in `base`, which is the Keys' pack. `region` names the region a model belongs to. The perf check counts a region pack's models, a region's atlas and any base-pack model whose row names a region as that region's own bytes, against the 3 MB per-region limit; every other base-pack model counts as shared.
- **Atlas surfaces.** A row's `atlas: { sheet, surfaces }` names the mesh nodes whose UVs sample the region's texture atlas, `packs/<pack>/assets/textures/atlas/<sheet>.png` (`sheet` is the region id; `tools/atlas` builds it and its layout, `<sheet>-layout.json`). The convention is glTF's: UV (0, 0) is the sheet image's top-left. Every triangle of an atlas surface keeps all three UVs inside one tile's inner rect (the tile minus its 4 px gutter), checked against the layout (`atlas_uvs_in_tiles`; the rule fails if the layout is missing). A facade mesh keeps its paint role, which the greyscale texel multiplies; a mesh showing colour art uses the white role `art`. Atlas tiles hold shapes, patterns, murals and real landmark lettering only, never invented words: those stay pack text that the game paints, so the in-game veto keeps working.
- **Vehicles** (kind `vehicle`, instanced traffic). The root `vehicle` sits on the ground under the middle of the wheelbase, front +Z, left +X, with the extras `length_m`, `width_m`, `height_m`, `wheelbase_m`, `hood_top_m`, `hood_front_m`, `hood_back_m` (the Z of the hood's front and back edges) and `class` (`car`, `truck`, `bus` or `trailer`); the bounding box matches the three sizes within 2%. One mesh node, `vehicle_body`, holds everything, wheels baked in (plus a `side_panel` text surface where the row lists one), so a type draws as one instanced mesh. An empty `hood` marks the middle of the hood's top surface (a van or truck with no hood puts it on the front bumper's top): the game launches a wheelie rider off it. The empties `light_head_l`, `light_head_r`, `light_tail_l` and `light_tail_r` mark the lamps. `paint_primary` is authored white (`#ffffff`), because the game tints each instance with its type's paint, which multiplies every colour.
- **Bridge bays** (kind `variants`, `bays: { roots, lengthM }`). A bay is the structure below and beside a deck the game builds itself, never the deck surface. Its root is the deck top (y = 0) at the bay's start, centred on the deck, and it runs along +Z for its `bay_m` extra, which matches the row's `lengthM` and the bay's real extent within 1%. Piers may reach down to `-pier_m` (an extra, matched within 1%). The game repeats bays along any deck and may stretch piers vertically.
- **Levels of detail** (kind `variants`, `lods: [{ lod0, lod1, maxRatio? }]`). The far root keeps at most `maxRatio` (default 0.3) of the near root's triangles, and its box, measured from its own root, stays within 5% of the near root's extent on every axis.
- **Sway.** Foliage meshes carry a `_SWAY` float vertex attribute (three.js exposes it as `_sway`), from 0 at the base to 1 at the tips. The game uses it as the vertex-shader sway amplitude.
- **Budgets** are per model in `catalog.mjs` `[default]`.

## How CI checks the committed GLBs

`models.test.ts` runs in the unit tier (`npm test`). For every catalog row it checks four things:

- the GLB is committed and under the 1 MB size check;
- every `score.mjs` check passes: budgets, names, roles, flat opaque materials, scale, ground, and the kind's rules (ramp geometry, waterline probes, variant layout and sway, bridge bays, levels of detail, the vehicle contract, text-surface UVs and extras, atlas UVs inside their tiles, outward winding, wire attach points);
- three's own `GLTFLoader` parses it, with the named nodes the game will look up;
- no GLB sits in any pack's `assets/models/` that the catalog does not list;
- the catalog's files still hold every row made before the per-region split, and each batch file's rows sit in its pack and region.

It also shows that the guards fire: a missing ramp, an impossible budget, a boat wider than its hull, and a text surface without its extras each fail. `score-rules.test.ts` does the same for the playtest 3 rules on small hand-made GLBs: a UV across two tiles, a vehicle with no hood, a bay 3% short, an lod1 at 40% of lod0 and an inward-wound part each fail, and a text surface with no normals is read by its winding. Against the trial's own GLBs, `score.mjs` flags the trial truck's slot between the planks (`ramp_no_slot`), the trial boat's rods sticking out (`nothing_sticks_out_past_hull`), and the other trial boat's double-sided hull (`double_sided_only_leaves`).

## Adding a model

1. Write `props/<name>.py`. Use `props/_lib.py`: `reset_scene()`, `make_mats()`, the `MB` mesh builder, `text_panel()` and `export()`. Put tuning numbers in named constants at the top. End the script with exactly one export, which prints `PROP_OK <path>`.
2. Add a row to your batch's file under `catalog/` with the asset id, pack and region, kind, budgets and node contract.
3. Run `npm run asset:build -- <name>`, `npm run asset:render -- <name>` and look at every render, then `npm run asset:check`.
4. Log the model in `THIRD_PARTY_ASSETS.md` as AI-made.
5. Commit the script, the catalog row and the GLB together.

## Provenance

The original models were scripted in Blender by an AI agent (Claude); CX1 optimisation and the eight shared traffic vehicles plus detached ramp trailer were scripted by Codex from text briefs. The truck, boat and palms were built from AI-generated concept sheets for the 2026-09-30 trial. All geometry is released under the repo's MIT licence and labelled AI-made in [THIRD_PARTY_ASSETS.md](../../THIRD_PARTY_ASSETS.md). No external models, fonts, textures or brand designs were used for CX1. The concept sheets are not in the repo.
