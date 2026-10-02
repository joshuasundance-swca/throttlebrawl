# tools/blender/riders: the rider models

Real riders with real proportions and loud costumes (run W-R; interview, 2026-10-02: "Real models now", "Real proportions, loud costumes"). Each rider is scripted in headless Blender from its pack file's `look`, exported as a GLB, uploaded to the Hugging Face dataset repo and pinned by `assets.lock.json`. They are not committed: the build bakes the pinned files in, and a region's riders load only when a race there starts. The game wears them in `src/render/riders/`.

Status `[default]`: done, not phone-verified.

## Commands

| Command | What it does |
| --- | --- |
| `node tools/blender/riders/build.mjs [<rider id> ...]` | Builds each rider twice into `.cache/riders/`, checks the two GLBs are byte-identical and within the triangle budget. Logs go to `.cache/riders/build/`. Needs `BLENDER_EXE` (Blender 5.2); without it, it exits 0 with a note. |
| `... build.mjs --pin` | Also pins each GLB in `assets.lock.json` (`scripts/assets.mjs add`). Then `npm run assets:upload` uploads them with the signed-in `hf` CLI and pins the commit; commit the lock in a normal PR. |
| `node tools/blender/render.mjs`-style renders | `blender --background --python tools/blender/render.py -- --glb .cache/riders/<id>.glb --out-dir <dir> --prop <id> --engine workbench` renders one from three angles. |

CI has no Blender. `riders.test.ts` (in `npm test`) downloads the pinned GLBs at the pinned commit, checks every sha256, checks each rider against the contract below, seats every rider on every bike in `packs/base/assets/models/bikes/` and checks the hands reach the bars and the feet the pegs, and drives whole rigs through the game's entity views.

## Files

| File | Role |
| --- | --- |
| `_rider_lib.py` | The figure: a `Rider` with its body, headgear, hair, clothes, prints, props and the export. Uses `../props/_lib.py`'s mesh builder. |
| `cast.py` | One costume function per rider, with its height, bulk, head size and colours. |
| `build_rider.py` | The Blender entry point: `-- --rider <id> --out <path>.glb`. |
| `build.mjs`, `catalog.mjs` | The runner and the list of riders (pack, region, triangle budget). |

## The contract (every rider)

- **Axes and origin.** As the props: authored Z up, exported +Y up, facing glTF **+Z**, the rider's left on **+X**, 1 unit is 1 m. The root `rider` stands on the ground (y = 0) under the feet, at rest: standing, arms down in a slight A, legs straight.
- **Bones.** Sixteen empties, all direct children of `rider`, at their joints: `hips` (the pelvis), `chest` (the waist pivot), `head` (the neck's base), `upper_arm_l/_r` (shoulders), `forearm_l/_r` (elbows), `thigh_l/_r` (hips), `shin_l/_r` (knees), and the flap bones `coat_l/_r` (coat tails, hinged at the back of the waist), `tie` (at the collar), `hair` (the back of the head: a braid, a hood, a bandana tail) and `prop`.
- **Markers.** `grip_l/_r` (palm centres, under the forearms) and `ankle_l/_r` (under the shins): the game measures the limbs with them.
- **Meshes.** Every mesh is a child of exactly one bone and moves rigidly with it (the game skins each vertex to that bone with weight 1, so a rider and its bike are one draw call). Meshes with the `detail` extra (faces, prints, letters, badges) come last and are dropped far from the camera.
- **Root extras.** `prop_mount` is what the prop rides on: `head`, `chest`, `hips` or `seat` (a seat prop's bone sits at `seat_m` above the ground, the seat under the hips, and the game puts it on the bike's `seat_anchor`). `seat_m`, `height_m`, `rider_id` and `triangles` are informational.
- **Flat colours by role** (`skin`, `hair`, `cloth_a` to `cloth_c`, `trim`, `boot`, `glove`, `helmet`, `visor`, `metal`, `print`, `prop_a`, `prop_b`, `dark`), faceted, triangulated, exported **without normals**. Clean, loud paint; no rust, grime or wear (the maintainer's veto). Every brand is invented. Deterministic: rebuilds are byte-identical.
- **Budget.** At most 1,800 triangles each (the cast is 834 to 1,332).

## The cast

| Rider | Costume | Prop (shed when hurt) | Bike (`look`) |
| --- | --- | --- | --- |
| player | Yellow riding jacket with a red stripe down the back (it reads from the chase camera), blue jeans, cream full-face helmet, bandana tail | Hip bag | Rustbucket 400 (the garage bike), painted red and yellow |
| Deacon Vane | Long black duster, flat-brimmed hat, goatee, bolo tie | The hat | Chopper |
| Chad Speedwell | Sponsor-patched white jacket, pink helmet, a grin | Phone gimbal (up in his hand for the selfie) | Stickered sport bike |
| Tammy Two-Stroke | Frosted beehive, teal sun visor, big sunglasses, leopard-print top, cigarette | Cooler on the seat | Dirt bike |
| Kevin from Accounting | Short-sleeved shirt, clip-on tie that streams over his shoulder, lanyard, glasses | Briefcase | Step-through |
| Mother Rust | Patched oilskin coat, waders, grey braid, gator-tooth necklace | Bucket hat | Bagger |
| Dial-Up | Beige helmet, coiled-cord chin strap, taped goggles, green hoodie | Modem on the seat | Rustbucket 400 |
| The Mayor | Seersucker suit, a sash that says MAYOR, a too-big helmet | VOTE sign on a pole | Touring flagship |
| Sgt. Pruitt | Khaki, white helmet, aviators, mustache | Ticket book | Police motorcycle |
| Trooper Dalrymple | Grey uniform, aviators | Campaign hat | Police motorcycle |
| Deputy Lindqvist | Green rain jacket with the hood out | Flashlight | Police motorcycle |
| Juniper Moss | Teal rain shell with a flapping hood, cafe-racer helmet, goggles | Travel tumbler | Streetfighter 750 |
| Old Growth | Red flannel, suspenders, full beard, yellow helmet | Thermos on the seat | Superbike 1000 |
| Gripman Gus | Navy waistcoat with brass trim, red neckerchief, gripman's cap, mustache | Brass bell | Moped |
| Pivot | Fleece vest, earbuds | Headset pushed up on his helmet | Carbon e-bike |
| Officer Meter | Hi-vis vest, peaked cap | Ticket printer | Parking trike |

## Provenance

Every rider here was scripted in Blender by an AI agent (Claude) from text briefs (each pack file's `look.description` and the interview); no external model, scan, concept image or brand. MIT, logged as AI-made in [THIRD_PARTY_ASSETS.md](../../../THIRD_PARTY_ASSETS.md).
