# Third-party assets

Every asset that is not original to this project is listed here, with its source, its licence and
where it is used. AI-generated assets are labelled as such. Prefer CC0 or CC-BY; avoid
non-commercial and no-derivatives licences (see [AGENTS.md](AGENTS.md#public-safety)).

npm packages are dependencies, not assets: their licences travel with them in `package-lock.json`.

| Asset | Source | Licence | AI-generated | Used in |
| ----- | ------ | ------- | ------------ | ------- |
| Road geometry and tags of US 1 (the Overseas Highway), baked by `tools/gis` | [OpenStreetMap](https://www.openstreetmap.org/copyright), © OpenStreetMap contributors | ODbL 1.0 (text in `packs/base/LICENSES/ODbL-1.0.txt`; the pack's `licenseRules` cover every `osm-` file) | No | `packs/base/regions/florida-keys/{networks,roads,routes}/osm-*.json` |
| Land elevation along the baked roads | [USGS 3DEP](https://www.usgs.gov/3d-elevation-program): "Map services and data available from U.S. Geological Survey, National Geospatial Program." | Public domain (US Government work) | No | the same `osm-` road files (`y` samples on land) |

Everything else in the build so far is original or made in code.
