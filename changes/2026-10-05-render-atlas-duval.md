---
kind: new
audience: player
---
Duval Street is no longer an empty palm-lined highway. Both sides of Duval and Whitehead Streets in Key West's Old Town are now lined with balconied shopfronts, conch houses and an open-air corner bar, with planters and scooter racks on the sidewalk, all painted with the Keys' new texture sheet: siding, shutters, storefront glass, awnings and murals. The Southernmost Point buoy and the Mile 0 marker still stand where they did.

For devs (playtest 3, T12.1, the atlas runtime; wave B's punch list, item 1).

- **The atlas at runtime** (`src/render/atlas.ts`, in the lazy model-reader chunk). It decodes a region's PNG-8 sheet in the game (the browser's own inflate, every PNG row filter) into a mipmapped sRGB `DataTexture` with `flipY` off, so UVs follow glTF's top-left origin. A test checks every tile's mean in the decoded Keys sheet against its layout.
  - A model whose meshes carry an `atlas_tile` extra bakes those UVs (`models.ts`) and puts every other vertex on the white tile. Its region's sheet loads with it (`ATLAS_SHEETS`).
  - `withAtlas` adds `farColor` (the vertex colour times the tile mean), so far stand-ins do not flash.
  - With the sheet missing, the plain material draws each picture as its mean. With the layout missing, the model draws as baked.
  - Only a geometry marked by the bake samples the atlas. A code-made box's own UVs are ignored (`scenery-merge.ts` `hasAtlasUv`).
- **Old Town** (`roadside.ts`). A roadside rule can now draw from another model (`model`) and stand buildings end to end as a street front (`Frontage`).
  - Each building is placed by its own width and depth, from its model's bounding box.
  - Its front is 9 m past the verge, behind the sidewalk palms, which stand 2.2 to 7.7 m out. Every building faces the road.
  - Buildings stay clear of the pedestrian zones, the pads, the landmarks, other roads and each other. Every corner stands on the drawn land.
  - The Keys kit's `oldtown-*` rules use this on roads tagged `key-oldtown`. Over seeds 1, 7 and 42, 71 to 79 % of each Old Town side is built front.
  - Trailers, traps, pelicans and bait boards are kept out of Old Town.
  - The buildings join the Keys' existing roadside stretches, which draw with the atlas as their map: one mesh each, so no new draw call.
  - Past 80 m (`ROADSIDE_FRONT_M`, `[default]`) the fronts draw as their stand-ins. Each stretch's levels of detail are now four runs of one buffer.
- **Budget**, from `scene-cost.test.ts` on Duval's route, 141 views, still scene only:
  - The busiest view, `osm-duval-street` at s 210, went from 96,860 to 103,726 triangles, against the still scene's 110,000 share and the 150,000 hard cap.
  - Draw calls peak at 53 (was 52), against the share of 80 and the cap of 120.
- **Shared edits riding along**, needed only by this change:
  - `render/index.ts`: one argument, passing the loaded models to the roadside layer.
  - `scene-cost.test.ts` passes them too, so the gate counts Old Town.
  - `keys-districts.test.ts` leaves rules that draw from another kit out of its keys-m1 district list; `duval.test.ts` covers them.
  - `scenery.test.ts` adds the kit's 8 variants.
  - `atlas.ts` joins `first-load.test.ts`'s must-stay-lazy list.
- **Not done here:**
  - The shop-name panels are blank. Their words are pack text, still to be painted.
  - `downtown.ts` carries no UVs yet: there is no San Francisco sheet until CX3, and T12.4 restacks those towers.
  - The pedestrian crowds the punch list mentions are zone content, not this lane's files.
- Not phone-verified, and no browser was run.
