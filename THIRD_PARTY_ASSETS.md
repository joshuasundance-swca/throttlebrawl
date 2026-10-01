# Third-party assets

Every asset that is not original to this project is listed here, with its source, its licence and
where it is used. AI-generated assets are labelled as such. Prefer CC0 or CC-BY; avoid
non-commercial and no-derivatives licences (see [AGENTS.md](AGENTS.md#public-safety)).

npm packages are dependencies, not assets: their licences travel with them in `package-lock.json`.

| Asset | Source | Licence | AI-generated | Used in |
| ----- | ------ | ------- | ------------ | ------- |
| Road geometry and tags of US 1 (the Overseas Highway), baked by `tools/gis` | [OpenStreetMap](https://www.openstreetmap.org/copyright), © OpenStreetMap contributors | ODbL 1.0 (text in `packs/base/LICENSES/ODbL-1.0.txt`; the pack's `licenseRules` cover every `osm-` file) | No | `packs/base/regions/florida-keys/{networks,roads,routes}/osm-*.json` |
| Land elevation along the baked roads | [USGS 3DEP](https://www.usgs.gov/3d-elevation-program): "Map services and data available from U.S. Geological Survey, National Geospatial Program." | Public domain (US Government work) | No | the same `osm-` road files (`y` samples on land) |
| Car-carrier ramp truck model (`models/props/tow-truck`) | Scripted in Blender by an AI agent (Claude), `tools/blender/props/tow_truck.py`, from an AI-generated concept sheet (2026-09-30 prop trial) | MIT (the repo's licence for originals) | **Yes**: AI-scripted model, AI concept art | `packs/base/assets/models/props/tow-truck.glb` |
| Centre-console fishing boat model (`models/props/boat`) | Scripted in Blender by an AI agent (Claude), `tools/blender/props/boat.py`, from an AI-generated concept sheet (2026-09-30 prop trial) | MIT | **Yes**: AI-scripted model, AI concept art | `packs/base/assets/models/props/boat.glb` |
| Coconut palm models, 3 variants (`models/scenery/palms`) | Scripted in Blender by an AI agent (Claude), `tools/blender/props/palms.py`, from an AI-generated concept sheet (2026-09-30 prop trial) | MIT | **Yes**: AI-scripted model, AI concept art | `packs/base/assets/models/scenery/palms.glb` |
| Mangrove clump models, 2 variants (`models/scenery/mangroves`) | Scripted in Blender by an AI agent (Claude), `tools/blender/props/mangroves.py`, from a text brief (no concept art) | MIT | **Yes**: AI-scripted model | `packs/base/assets/models/scenery/mangroves.glb` |
| Bait shack model (`models/scenery/bait-shack`) | Scripted in Blender by an AI agent (Claude), `tools/blender/props/bait_shack.py`, from a text brief (no concept art) | MIT | **Yes**: AI-scripted model | `packs/base/assets/models/scenery/bait-shack.glb` |
| Power pole model (`models/scenery/power-pole`) | Scripted in Blender by an AI agent (Claude), `tools/blender/props/power_pole.py`, from a text brief (no concept art) | MIT | **Yes**: AI-scripted model | `packs/base/assets/models/scenery/power-pole.glb` |
| Flats skiff model (`models/scenery/skiff`) | Scripted in Blender by an AI agent (Claude), `tools/blender/props/skiff.py`, from a text brief (no concept art) | MIT | **Yes**: AI-scripted model | `packs/base/assets/models/scenery/skiff.glb` |
| Road sign blanks, 2 variants (`models/scenery/road-signs`) | Scripted in Blender by an AI agent (Claude), `tools/blender/props/road_signs.py`, from a text brief (no concept art); the game draws the words | MIT | **Yes**: AI-scripted model | `packs/base/assets/models/scenery/road-signs.glb` |

The concept sheets for the truck, boat and palms were made with the Codex CLI's built-in image generation for the trial. They are not in the repo; the models are new geometry, written as code and not traced from the images. Every Blender model is rebuilt from its script (see [tools/blender/README.md](tools/blender/README.md)).

Everything else in the build so far is original or made in code.
