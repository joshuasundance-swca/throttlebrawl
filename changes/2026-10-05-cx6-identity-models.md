---
kind: dev
audience: dev
---
More models that make the real places look like themselves (playtest 4, P4-19, Codex batch CX6), the ones CX5 left: San Francisco's taller buildings, two landmarks, the headlands, a cruise ship for Duval's end, an osprey post, and Chuckanut's sandstone with Lake Samish's shore. Nothing places them yet: a later run wires each into its route.

- **San Francisco's terraces** (`region-sf`, `models/scenery/sf-apartments`, 38,244 bytes). Six buildings that stand in the row houses' plots (front wall at the root, 11.5 m deep, one plot 7 m wide or two side by side), so Russian Hill and North Beach are not only painted Victorians:
  - `sf_flats_a` and `sf_flats_b`: Edwardian flats with a box bay, and Mediterranean flats with a curved bay and a tile pent roof (one plot, 14.6 m).
  - `sf_apartment_a`: a bracketed Edwardian apartment block with a fire escape (two plots, 18 m).
  - `sf_apartment_b`: a six-storey mid-century block with ribbon windows and slab balconies (two plots, 20 m).
  - `sf_corner_l` and `sf_corner_r`: corner buildings with a shop below, windows on the cross-street side, and a blank shop sign each (`sf_corner_l_sign`, `sf_corner_r_sign`).
- **San Francisco landmarks** (`sf-landmarks`, now 59,304 bytes): the copper-green flatiron at Columbus and Kearny (`sf_flatiron_lod0/1`, a wedge with a domed prow, 35.5 m) and the old mission chapel on Dolores Street (`sf_mission_church`, whitewashed adobe, three bells, a tile roof).
- **The headlands and Twin Peaks** (`models/scenery/sf-headlands`): a low concrete gun battery with two open gun pits (`gg_battery`), coyote brush, and a red chert outcrop.
- **The Keys:**
  - `keys-landmarks` gains a docked cruise ship (`cruise_ship_lod0/1`): invented and unbranded, 290 m long and 60 m to the funnel. The sheet's "white wall behind the square" at Duval's Gulf end.
  - `keys-identity` gains an osprey on its nesting post (`keys_osprey_post`, 9 m).
- **Chuckanut and Lake Samish** (`region-pnw`, `models/scenery/pnw-shore`, 20,296 bytes):
  - sandstone rock cuts, 4.5 m and 8 m, as 6 m sections that lay end to end;
  - a low drop-side wall;
  - a 20 m bluff section that falls 40 m below the road's edge;
  - two boulders;
  - a lake cabin and a dock.
- **The earlier nodes are unchanged.** The three extended kits keep every earlier node exactly as it was. `cx6-baseline.json` was recorded before the edit, and an independent reader agrees against copies saved then.
- **No words in any model.** The two shop signs are blank text surfaces for pack text, so the in-game veto still reaches them.
- **Review.** The coordinator sent Chuckanut's pieces back twice:
  - after the render review, because the rock cuts read as chests of drawers, the bluff as a totem and the boulders as boxes;
  - after a new winding check, which welds a part across its colours, found a folded ledge in the two cuts.
- **Byte caps.** CX5's test capped `sf-landmarks` at 45 KB; it now allows 60 KB, because the flatiron and the mission church live in that kit.
- **Not built:**
  - a cable car (`models/props/cable-car` is already on main);
  - a Lombard stair or hedge kit (no sheet row needs a model there; the hedge and beds exist, and the beds wait on a slope seam).

Checks:
- `build.mjs --check` rebuilt all 76 catalog rows twice each, byte for byte; the shore kit was checked again after its last pass.
- The score ran 2,579 checks on 76 GLBs, with 0 failures.
- `tools/blender/cx6.test.ts` (30 tests) checks:
  - the caps, bodies and levels of detail;
  - the terrace plots and the corner signs;
  - the section ends and the bluff's drop;
  - the footprints, and the append-only baseline;
  - winding per colour, and across colours.

  It was written before the models and failed for missing nodes. Its new cross-colour winding check failed on the folded ledge before the fix.
- An independent reader agrees on 203,820 bytes and 10,340 triangles across the six GLBs.
  - It found 204 closed parts in the new nodes, all wound outward; every one reads inward when reversed (the control).
  - It found every earlier node of the three extended kits unchanged.
- `src/render/landmarks-cx6.test.ts` bakes the two extended landmark kits through the shipped asset manifest, as the game does. The flatiron, the mission and the ship resolve near and far.
- `base-pack.test.ts` lists 76 committed GLBs (22 in region packs) in the shipped manifest.
- Download: the region packs grow by 69,252 bytes (San Francisco) and 20,296 bytes (Pacific Northwest), and the base pack by 11,412 bytes. Draw calls, triangles and first-load JavaScript do not change, because nothing is placed.

Not phone-verified; no browser was run.
