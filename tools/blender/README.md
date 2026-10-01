# tools/blender: the scripted model pipeline

Python scripts build each 3D model in headless Blender, from an empty scene, and export one GLB. The GLBs are committed to the base pack under `packs/base/assets/models/`, because CI has no Blender. CI checks the committed files instead: `tools/blender/models.test.ts` runs in `npm test`.

The pipeline was approved after the 2026-09-30 blind prop trial (playtest 1c, item 4, 2026-09-30: "We can start"). It is that trial's harness, ported. The truck, the palms and the boat are the trial models the maintainer picked; the scenery pack is new.

Status `[default]`: every model is "done, not phone-verified". The renders are Blender EEVEE renders, not in-game frames.

## What you need

- **Blender 5.2 LTS.** Set `BLENDER_EXE` to the `blender` executable. Without it, every command below prints a note and exits 0, so the npm scripts skip cleanly on machines without Blender, CI included.
- **Node 22.** The repo already requires it. `score.mjs` has no dependencies.
- **Optional: Python with Pillow** (`PYTHON`, default `python`). It draws the contact sheet; without it the sheet is skipped with a note.
- **Optional: the npm registry** for `--validate` (it runs `npx @gltf-transform/cli@4.5.1 validate`, the Khronos validator).

## Commands

| npm script | Same as | What it does |
| --- | --- | --- |
| `npm run asset:build [-- <prop> ...]` | `node tools/blender/build.mjs` | Builds each prop twice, checks the two GLBs are byte-identical, scores the first, and writes it to `packs/base/assets/<asset>.glb` if it changed. Logs go to `.cache/blender/build/`. |
| `npm run asset:check` | `node tools/blender/build.mjs --check` | Rebuilds into `.cache` only and checks that each rebuild is byte-identical to the committed GLB. Run it after changing a script, to prove the commit matches its source. |
| `npm run asset:render [-- <prop> ...]` | `node tools/blender/render.mjs` | Renders each committed GLB from 3 cameras into `.cache/blender/renders/`, and makes `contact-sheet.png` there. `--engine workbench` gives a quick preview. |
| `npm run asset:score [-- <prop> ...]` | `node tools/blender/score.mjs` | Scores the committed GLBs (no Blender needed). `--json` prints everything; `--validate` adds the Khronos validator; `--glb <file> --prop <name>` scores a GLB from elsewhere. |

Every command prints an `[examined]` line with what it looked at. A build fails (exit 1) if Blender fails, if the two builds differ, or if a score check fails. `--check` also fails when a rebuild differs from the committed file.

## Files

| File | Role |
| --- | --- |
| `catalog.mjs` | One row per model: its script, asset id, kind, budgets, camera views and node contract. Everything else reads it. |
| `props/*.py` | One Blender script per model. `tow_truck.py`, `boat.py` and `palms.py` are the trial scripts and stand alone. The scenery scripts share `props/_lib.py`. |
| `build.mjs`, `render.mjs`, `blender.mjs` | Run Blender (from `BLENDER_EXE`) headless. |
| `render.py`, `sheet.py` | The camera rig, run inside Blender, and the contact sheet (Pillow). |
| `score.mjs` | Budgets and geometry checks on a GLB, in plain Node. |
| `models.test.ts` | The CI gate on the committed GLBs (see below). |
| `ruff.toml` | The Blender Python is linted with ruff only: `ruff check tools/blender`. |

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

**Phone budget.** The target phone holds 60 fps at about 50 draws and 50k triangles for the whole scene: road, riders, traffic, water and scenery. All six scenery GLBs on screen together cost 28 instanced draws, and 19 if each is merged by material. So a chunk should show a few kinds of scenery at a time, or the renderer should merge static scenery per material. Triangles are cheap by comparison. For example, 40 palms, 12 mangroves, 10 poles, 6 signs, a shack and 3 skiffs come to about 25.7k triangles (scripted from the table above).

## Conventions (every model)

- **Axes.** Each model is authored Z up in Blender and exported as glTF +Y up. The front (the truck's cab, the boat's bow, a sign's face, the shack's porch) faces glTF **+Z**. The prop's left (port, the driver's side) is **+X**. 1 unit is 1 m, and every node has scale 1.
- **Origin.** The origin is the ground (y = 0) under the prop's anchor, as named in the table: the truck's ramp foot, the boats' waterline, each variant's base.
- **Names.** Node, mesh and material names are snake_case and unique within a GLB.
- **Flat colours by role.** Each material is a Principled BSDF with a base colour and nothing else: metallic 0, no textures, no vertex colours, no emission, opaque. A material's name is its **role** (the list is in `catalog.mjs`), so every look can recolour by role. Only the leaf roles (`foliage`, `foliage_dark`) are double-sided.
- **Faceted normals.** No smooth shading.
- **Deterministic.** Randomness uses a fixed seed and nothing reads the clock, so rebuilds are byte-identical (`asset:check`).
- **Text surfaces.** A text surface is a flat panel facing +Z, a separate node with one material and a UV map. It carries the extras `text_surface: true`, `width_m` and `height_m`. In glTF's UV convention, UV (0, 0) is the panel's top-left corner as seen from the front, and (1, 1) is the bottom-right. The game paints the words into a canvas texture on that node. No other mesh has UVs.
- **Sway.** Foliage meshes carry a `_SWAY` float vertex attribute (three.js exposes it as `_sway`), from 0 at the base to 1 at the tips. The game uses it as the vertex-shader sway amplitude.
- **Budgets** are per model in `catalog.mjs` `[default]`.

## How CI checks the committed GLBs

`models.test.ts` runs in the unit tier (`npm test`). For every catalog row it checks four things:

- the GLB is committed and under the 1 MB size check;
- every `score.mjs` check passes: budgets, names, roles, flat opaque materials, scale, ground, and the kind's rules (ramp geometry, waterline probes, variant layout and sway, text-surface UVs and extras, wire attach points);
- three's own `GLTFLoader` parses it, with the named nodes the game will look up;
- no GLB sits in `packs/base/assets/models/` that the catalog does not list.

It also shows that the guards fire: a missing ramp, an impossible budget, a boat wider than its hull, and a text surface without its extras each fail. Against the trial's own GLBs, `score.mjs` flags the trial truck's slot between the planks (`ramp_no_slot`), the trial boat's rods sticking out (`nothing_sticks_out_past_hull`), and the other trial boat's double-sided hull (`double_sided_only_leaves`).

## Adding a model

1. Write `props/<name>.py`. Use `props/_lib.py`: `reset_scene()`, `make_mats()`, the `MB` mesh builder, `text_panel()` and `export()`. Put tuning numbers in named constants at the top. End the script with exactly one export, which prints `PROP_OK <path>`.
2. Add a row to `catalog.mjs` with the asset id, kind, budgets and node contract.
3. Run `npm run asset:build -- <name>`, `npm run asset:render -- <name>` and look at every render, then `npm run asset:check`.
4. Log the model in `THIRD_PARTY_ASSETS.md` as AI-made.
5. Commit the script, the catalog row and the GLB together.

## Provenance

Every model here was scripted in Blender by an AI agent (Claude). The truck, the boat and the palms were built from AI-generated concept sheets: one image per prop, made for the 2026-09-30 trial with the Codex CLI's built-in image generation. The scenery pack was built from text briefs only. The models are released under the repo's MIT licence and logged as AI-made in [THIRD_PARTY_ASSETS.md](../../THIRD_PARTY_ASSETS.md). The concept sheets themselves are not in the repo.
