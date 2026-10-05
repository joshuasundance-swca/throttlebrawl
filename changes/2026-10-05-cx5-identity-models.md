---
kind: dev
audience: dev
---
Models that make the real places look like themselves (playtest 4, P4-19, Codex batch CX5). Nothing places them yet: a later run wires each into its route.

- **The Gorge** (`region-pnw`, `models/landmarks/gorge-landmarks`, 53,660 bytes). The kit was registered in the game but had no file. Its nodes:
  - `vista_house_lod0/1`: the domed stone rotunda at Crown Point, within 12 m of its centre (the loops pass about 29 m out).
  - `multnomah_falls_lod0/1`: a 160 m basalt cliff with the two-tier white falls and the footbridge.
  - `multnomah_lodge`: the stone lodge.
  - `gorge_arch_bay` (24 m) and `gorge_arch_span_46` (46 m): concrete deck-arch spans under an 11 m deck, for the Latourell and Shepperd's Dell bridges in place of timber trestles. Nothing stands above the deck.
- **Pacific Northwest scenery** (`models/scenery/pnw-identity`): two madrones (one leans out over the water), and a 6 m section of the historic highway's masonry guard wall with arched openings, which lays end to end.
- **The Keys** (base pack, `models/scenery/keys-identity`):
  - Key deer: a buck, and a doe grazing.
  - A mile post whose face is a blank text surface, `keys_mile_marker_face`.
  - A banyan, a poinciana in bloom and a frangipani, for Old Town in place of street palms.
  - Two invented open-front Duval bars, with blank name boards `duval_open_bar_a_name` and `_b_name`.
- **Keys traffic and landmarks:**
  - `models/traffic/pedicab` follows the vehicle contract at the `pedicab` type's 2.6 × 1.2 m.
  - East Martello (`east_martello_lod0/1`) and West Martello (`west_martello`) are added to `keys-landmarks`.
- **San Francisco:**
  - `models/scenery/sf-identity` holds a Monterey cypress and a eucalyptus for the Presidio.
  - `sf-landmarks` gains a Chinatown gate, `sf_dragon_gate`. It spans an 11 m road with a 12 m by 6 m clear opening, and its plaque is a blank text surface.
  - `sf-landmarks` also gains a twin-spired church, `sf_twin_spire_lod0/1`.
- **Portland:** `pdx-landmarks` gains an Old Town Chinatown gate, `pdx_chinatown_gate`, with an 8 m by 5.5 m clear opening and a blank plaque.
- **No words in any model.** Every name, number and plaque is pack text the game paints, so the in-game veto can still cut it.
- **Review.** The coordinator sent three models back for a second pass after looking at the renders:
  - the falls read as a black monolith;
  - the arch bays read as thin steel legs;
  - the lodge read as an apartment block.

  The arch bays' triangle caps went up to 560 and 880 so their ribs could be solid.

Checks:
- `build.mjs --check` rebuilt all 73 catalog rows twice each, byte for byte.
- The score ran 2,402 checks on 73 GLBs, with 0 failures.
- `tools/blender/cx5.test.ts` (31 tests) checks the triangle caps, the levels of detail, the bays, the gates' openings, winding, and that the three extended kits' earlier nodes are unchanged against a baseline recorded before the edit.
- An independent reader agrees on 238,392 bytes and 13,370 triangles across the eight GLBs.
  - Its winding check covers 606 closed parts. All are wound outward, and all flip under a reversed control.
  - It found every earlier node of the three extended kits unchanged.
- `src/render/landmarks-cx5.test.ts` bakes the four landmark kits through the asset manifest the build ships, as the game does. Every new node resolves near and far, with its blank boards. A wrong surface count fails it (the control).
- `base-pack.test.ts` lists all 73 committed GLBs in the shipped manifest, 19 of them in region packs.

Not phone-verified; no browser was run.
