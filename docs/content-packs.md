# Content packs and data formats

## In plain words

Tag: summary only; the tags on the choices are in the sections below.

Everything that makes the game *this* game lives in plain data files, not in code: the bikes, the riders and their grudges, the weapons, the events, the regions, the roads, the trash-talk lines, the HUD layouts and the feel presets from the tuning panel.

Those files are grouped into **content packs**. A pack is a folder with a small label file (`pack.json`) that says what it is, which version it is, and which other packs it needs. The whole base game is simply **pack zero**, called `base`. Later regions (chapters of the tour) can ship as their own packs.

The files are JSON, a plain text format that both people and coding agents can read and edit. Each kind of file has a **schema**, a machine-checkable description of what a valid file looks like. A checker runs as part of the normal tests, so a typo like a missing comma or a weapon with no damage gets caught before it reaches the phone.

Formats carry version numbers, and the game refuses to load a pack written in a format it does not understand. While every pack lives in this repo, a format change simply edits those packs in the same change; automatic upgrading of outside packs is built only when outside packs are supported. Letting players load their own packs (mods) is shelved, but nothing here blocks it.

Rare "weird events" (a hurricane gust, a funeral procession, a cult roadblock, a bounty on the player) and radio stations are content too. Their formats are reserved here so they arrive as data, but they are not built for the first milestones.

This doc owns **file formats only**. How the game finds, loads, caches and streams these files at runtime is in [the architecture doc](./architecture.md).

## Tags and scope

Tag: `[default]` for the scope split between this doc and the architecture doc.

Every non-trivial choice carries one tag:

- `[decided]`: traces to a maintainer answer.
- `[default]`: a proposal from this doc; the maintainer or a later agent may change it.
- `[open]`: needs the maintainer; also listed in [Open questions](#open-questions).

Out of scope here: runtime loading, caching, streaming and chunk scheduling (see [the architecture doc](./architecture.md)); the save-file format; the GIS pipeline's internals (only its *output* interface is defined here, in [Road networks](#road-networks-roads-and-routes)); game balance numbers. Numbers in the examples are placeholders for shape, not tuned values.

If this doc and `./architecture.md` disagree on anything runtime-related (the coordinate axes, the asset loader, load order), the architecture doc wins and this doc gets corrected.

## Maintainer decisions this doc builds on

Tag: `[decided]` for each line below; everything else in this doc builds on these.

- Tracks, rivals, bikes and taunts live in editable data files, not in code ("Yes, data files").
- Extensibility: data files plus content packs now; full player mods "maybe later", and the pack format should make that cheap.
- Weapons, rivals and assets must be extensible and easy to change.
- Barks (rider trash talk) must be contextual and non-repetitive: tagged lines plus memory, such as references to grudge history. AI tie-in later. AI barks are generated offline first, live generation optional later.
- In M1, voices are text bubbles.
- One connected road network: roads join at junctions, each road has along/across coordinates, and races are routes through it. It is designed for chunk streaming of big GIS regions.
- Curated real roads, proven incrementally. On licences the maintainer said they are "all basically fine".
- Region 1 is the Florida Keys / A1A. Track 1 is a coastal highway.
- Event types: classic race, takedown hunt, cop escape, grudge match. The race rules follow an "objectives mix". Time of day is set per event, and weather comes later.
- Cops: a mix of tier-rising, every-race and chaos-summoned, with some randomness. Local cops in every region.
- Weapons: club/pipe, chain, wasteland junk, cop baton/taser. A steal is a snatch timed on the wind-up.
- Bikes: 3 bikes to buy with cash, each a clear step up. Slower bikes are wanted as a direction: "Maybe slower bikes too", then "kinda all of these but also to enjoy the scenery" (a slow starter for readable fights, scooters/mopeds/dirt bikes, a lower overall option, a scenic option). How many slow bikes ship in v1, and whether they count among the 3, is not decided (`[default]` below).
- Riders: a few presets, extensible. About 8 named rivals, with roughly 4 regulars plus 4 locals per region; the split is tentative, but "definitely local cops".
- Weird events: rare, data-driven race modifiers, all four kinds wanted (nature chaos, human chaos, wasteland weird, league stunts), with room to grow. Timing is M4 or the shelf `[default]`.
- Radio stations by genre, plus regional stations; surf and rockabilly first for the Keys. DJ lines come later with the AI barks. The M1 and M2 scores stay a single original score. Other soundtrack genres that appeal (tentative, "idk"): grunge, stoner/desert, swamp blues.
- In-game veto: long-press a bark subtitle, billboard or sign and choose "cut this". The flag goes into the debug report, and agents then remove the item and record it in the taste log.
- First run is race-first (a `[default]`; the intro gets iterated on). Beating the boss plays a next-region teaser and free play continues afterwards.
- Easter eggs, all wanted: secret roads and shortcuts, a secret rider or bike, 90s-internet references, real-place gags. Shelf or M4/M5 `[default]`.
- From the maintainer's cockpit answers (2026-09-29): grudges are saved with the career; radio tracks come from both code-made and AI-generated songs, and the maintainer cuts tracks with "cut this" like rival lines; the failure-state default is Road Trip, with Classic and Hardcore later; and when the real Overseas Highway is ready, the maintainer rides both roads and picks, and the other stays as an alternative route.
- Configurable HUD: each element can be toggled and moved, with presets (Full, Classic, Minimal). Movable, configurable touch buttons.
- An in-game tuning panel with presets from M1.
- The goal: bundle assets into the build at the start, stream and cache them later, "I don't want to be limited in the future." One manifest abstraction as the mechanism is the coordinator's answer to that goal, accepted on the blueprint page (`[default]`).
- Big or generated assets live in a Hugging Face dataset repo; mind the HF 10 MB, LFS and Xet limits. What exactly those limits do is (unverified) here.
- The coordinator decides the hard-to-change technical calls, including versioned saves and packs and one GIS coordinate system (the maintainer delegated these; the choices themselves are `[default]`).
- Agents invent content freely within the tone guide; the maintainer vetoes; keep a taste log.
- The repo is public from day one under the MIT licence, with no "Road Rash" in names or branding. The game is inspired by Road Rash (EA, 1991–2000).

## File format choice

Tag: `[default]` for the choice; the reasons follow.

**Content files are strict JSON, validated against schemas written once in TypeScript with Zod, from which JSON Schema files are generated for editors.**

Why JSON data, not TypeScript data modules:

- **Packs must load without compiling code.** A future "load pack" button reads a folder or zip at runtime. JSON parses safely. A TypeScript or JavaScript data file would need a compiler in the browser, and loading someone else's script means running someone else's code. Data-only packs keep the mod door open and safe.
- **Agents edit JSON reliably.** Every coding agent reads and writes JSON well. Editors get autocomplete and inline errors from generated JSON Schema files mapped by folder (see below), so files carry no per-file `$schema` line.
- **Validation errors point at the exact field**, for example `packs/base/weapons/lead-pipe.json /steal/windowEndS: must be at most windupS`.
- **Offline tools emit it trivially.** The Python GIS pipeline and the AI bark generator can both write JSON with no JavaScript toolchain.

Why Zod as the one source of truth:

- One definition gives three things: the TypeScript types the game code uses, the runtime validator the loader and linter use, and the JSON Schema files editors use.
- Cross-field rules, such as "the steal window must sit inside the wind-up", are written as refinements in the same place. JSON Schema cannot express all of them, so the generated `.schema.json` files are advisory editor help; the Zod validator is the real gate.
- **Editor help is generated on demand, not committed.** `npm run schemas` writes the JSON Schema files into the git-ignored `.cache/schemas/`, and one `json.schemas` block in the workspace's `.vscode/settings.json` maps each folder glob to its schema (for example `packs/*/weapons/*.json` to `weapon.schema.json`). That editor setting is `[default]`, and how every editor treats a workspace-relative schema path is (unverified) here. Committing generated files would only add a freshness check that fails whenever a schema is edited, which is a redundant gate; the `type` field already makes each file self-describing for the validator.
- Version facts, fetched 2026-09-29: `npm view zod version` returned `4.6.5`. The Zod docs page on JSON Schema says: "Zod supports native JSON Schema conversion" through `z.toJSONSchema()`, with "Draft 2020-12 (default)". The same page says "Introduced in `zod@3.20.0`", which is earlier than expected for a Zod 4 feature. The quote came through a summarizing fetch, so treat the introduction version as (unverified); pin the real version at scaffold time. The page also says some types "cannot be reasonably represented", such as `z.transform()` and `z.date()`. Schemas for content must avoid those types, so dates are ISO strings.
- The alternative is TypeBox, whose schemas are JSON Schema objects natively, validated with Ajv (`npm view ajv version` returned `8.20.0`). It is a fine swap if Zod's JSON Schema output ever proves lossy. Either way the data files do not change.

Rules for the files themselves `[default]`:

- Strict JSON: no comments, no trailing commas. Put human notes in the optional `meta.notes` field.
- UTF-8, LF line endings, 2-space indent, and a trailing newline. A formatter (Prettier) normalises them so diffs stay small.
- **One entry per file** (one bike, one weapon, one rider), and the filename equals the entry's `id`. Parallel agent lanes then touch disjoint files and rarely conflict. The exceptions are bark sets (many short lines per file), road sample tables, and the small lists inside a region file (signs and billboards, each with its own id).
- Big numeric tables (road samples) may use a binary sidecar later; see [Road networks](#road-networks-roads-and-routes).

## Pack layout and manifest

Tag: `[default]` for the layout and for base being pack zero; `[decided]` that content packs exist ("data files + content packs now").

### Folder layout

```text
packs/
  base/                         # pack zero: the whole base game
    pack.json                   # manifest (hand-written)
    bikes/            <id>.json
    riders/           <id>.json # rivals, cops, player presets
    crews/            <id>.json
    weapons/          <id>.json # includes punch and kick
    events/           <id>.json
    traffic/          <id>.json # traffic, pedestrian and animal kinds
    looks/            <id>.json # visual style presets (M3)
    modifiers/        <id>.json # weird-event modifiers (reserved, M4 or shelf)
    stations/         <id>.json # radio stations (reserved, later)
    careers/          <id>.json
    regions/
      florida-keys/
        region.json
        networks/     <id>.json # road network: junctions + road list
        roads/        <id>.json # one road: lanes, tags, features, samples
        routes/       <id>.json # a path through the network for events
    barks/            <set-id>.json
    hud/              <id>.json
    tuning/           <id>.json
    assets/                     # models, textures, audio, stills, data (backdrop/)
      models/ textures/ audio/ stills/
    LICENSES/                   # per-folder licence texts, e.g. ODbL for OSM roads
src/content/schema/             # the Zod source of truth
tools/packs/                    # validator CLI, indexer, schema emitter (npm scripts)
.cache/schemas/                 # generated JSON Schema for editors (git-ignored)
```

The file `pack.index.json` is **generated** by the indexer at dev and build time and is not committed. It lists every file in the pack with its type and, for assets, the manifest fields `{id, kind, source, path, bytes, hash, packId}` that [the architecture doc](./architecture.md#asset-manifest) defines (`hash` is a SHA-256). The runtime's asset manifest is the union of the loaded packs' indexes. A static web host cannot list folders, so the runtime reads this index instead of guessing paths, and agents never hand-maintain it. Where this doc and [the engineering doc](./engineering.md#big-and-generated-assets) describe the manifest differently, the architecture doc wins.

Where the index lives `[default]` (M1 content-1): `npm run packs:check` writes each pack's index to `.cache/packs/<packId>/pack.index.json`, a folder git ignores, so it can never be committed by accident. M1 bundles the base pack through Vite's `import.meta.glob`, so the runtime does not read the file yet; the build copies it next to a pack when the first streamed pack or remote asset needs it.

### The manifest: `pack.json`

```json
{
  "type": "pack",
  "id": "base",
  "name": "Throttlebrawl base game",
  "version": "0.1.0",
  "formatVersion": 1,
  "gameVersion": ">=0.1.0",
  "dependencies": {},
  "description": "Pack zero. Everything in the base game, including Region 1: the Florida Keys.",
  "authors": ["the maintainer", "agents (see meta.provenance per entry)"],
  "license": "MIT",
  "licenseRules": [
    {
      "paths": [
        "regions/*/networks/osm-*.json",
        "regions/*/roads/osm-*.json",
        "regions/*/roads/osm-*.bin",
        "regions/*/routes/osm-*.json"
      ],
      "spdx": "ODbL-1.0",
      "attribution": "Road data © OpenStreetMap contributors, available under the Open Database License.",
      "licenseFile": "LICENSES/ODbL-1.0.txt"
    }
  ],
  "assetSources": {
    "default": "baked",
    "rules": []
  },
  "defaults": { "tuning": "registry", "hud": "classic" },
  "idAliases": {},
  "meta": {
    "notes": "The base game is itself a pack so every content path is exercised from day one."
  }
}
```

| Field | Meaning |
|---|---|
| `id` | Kebab-case, globally unique. `base` is reserved for pack zero. Other packs use a descriptive id such as `region-pnw`. |
| `version` | Semantic version of the pack's *content*. Bump it whenever the content changes. |
| `formatVersion` | Integer version of the *file formats* (schemas) the pack is written in. See [Versioning and migration](#versioning-and-migration). |
| `gameVersion` | A semver range of game builds the pack claims to work with. It is advisory; `formatVersion` is what the loader enforces. |
| `dependencies` | Map of pack id to semver range, for example `{ "base": "^0.3.0" }`. Only listed packs may be referenced. |
| `license`, `licenseRules` | The default SPDX licence for the pack, plus per-path overrides with the attribution text the credits screen must show. |
| `assetSources` | Where assets come from: `baked` into the build, or fetched from a `remote` store. See [Asset references](#asset-references). |
| `defaults` | The shipped default tuning preset and HUD layout, as ids, plus an optional `look` (a [look](#look) id, added in M3; until it is set the render lane's recommended default look applies), and an optional `engineSoundByClass` (below). Only the `base` pack's `defaults` are read; other packs' are ignored. The reserved tuning id `registry` means "the parameter registry's own defaults" (it has no file and cannot be a filename). |
| `defaults.engineSoundByClass` | The engine voice of each bike class (playtest 2, 2026-10-02: "a voice per bike"), as data rather than code `[default]` (run W-S): a map from a [bike](#bike) `class` to an `engineSound` block of the same shape a bike file has, for example `{ "chopper": { "preset": "v-twin" }, "moped": { "preset": "two-stroke-buzz", "idleHz": 46, "redlineHz": 230 } }`. A rider drawn on a class (`look.bikeClass`, see [Rider](#rider-rivals-cops-player-presets)) sounds like that class: its voice replaces the sim bike's own `engineSound`, until the career gives riders real bikes. A class with no entry keeps the bike's own. Keys must be classes from the closed list; a preset name audio does not know falls back to its default patch. Presentation-only, like every `engineSound`. |
| `idAliases` | Old id to new id, so renaming content never breaks saves or replays. |

## Conventions shared by every entry

Tag: `[default]` throughout this section.

### The envelope

Every entry file has the same outer shape:

```json
{
  "type": "weapon",
  "id": "lead-pipe",
  "name": "Lead Pipe",
  "tags": ["blunt", "roadside"],
  "meta": {
    "status": "live",
    "notes": "Starter pickup. Should feel slower than the chain but hit harder.",
    "provenance": { "origin": "agent", "author": "agent", "createdAt": "2026-10-01" }
  }
}
```

- `type` repeats what the folder implies, so the linter can check a file by its content alone, and moving a file cannot silently change what it is.
- `tags` are free-form lowercase strings. Selection rules (barks, traffic mixes, weapon spawns) match on them.
- `meta.status` is one of:
  - `live`: the default. It follows the decided rule that agents invent content freely.
  - `vetoed`: the maintainer said no. The entry stays in the file as the **taste log**, so a later agent or AI batch does not recreate it, and the loader skips it.
  - `draft`: loaded only in dev and staging builds.
- `meta.provenance` records who or what made the entry:
  - `origin` is one of `human`, `agent`, `ai-batch`, `gis-pipeline`.
  - `author` is a role, never a personal name or handle: `maintainer`, `agent`, or a tool name.
  - For `ai-batch`, also record `batchId`, `model`, `promptRef` (a repo path to the prompt file), `generatedAt`, and optionally `reviewedAt`.
  - For `gis-pipeline`, see [Provenance and licence of road data](#provenance-and-licence-of-road-data).
- **`meta` is optional.** Its default is `{ "status": "live", "provenance": { "origin": "agent" } }`. `meta.provenance` is required only when `origin` is `ai-batch` or `gis-pipeline`, because only those two need their trail preserved. The examples below show `meta` on most entries to illustrate the shape; an M1 file may leave it out.

#### In-game veto ("cut this")

`[decided]` that the player-facing flow exists: long-press a bark subtitle, billboard or sign and choose "cut this". The flag goes into the debug report, and agents then remove the item and record it in the taste log. `[default]` for the reference format and the mechanics below.

- Every item that can be vetoed has an id that is stable and unique inside its entry: a bark line, a sign, a billboard. That is why signs and billboards are objects with ids, not bare strings.
- **Content reference format:** `<packId>:<type>/<entryId>#<itemId>`, for example `base:bark-set/kevin-core#kevin-pass-email` or `base:region/florida-keys#ices-before-road`. The debug report's "cut this" list uses exactly this format. The save file uses the same reference to remember which bark lines were heard.
- **The agent's fix** is to set the item's `status` to `vetoed` (bark lines, signs and billboards accept the same `live`, `vetoed` and `draft` values as `meta.status`) and to write the reason in its optional `note`. The vetoed item stays in its file as the taste log the AI-batch generator reads, the loader skips it, and the agent adds a human-readable entry to [the tone guide's taste log](./tone-guide.md#taste-log).
- Whole entries (a rival, a modifier, a station) are vetoed with `meta.status` as above.
- **Radio tracks** are vetoable items inside their station entry, because the maintainer cuts tracks the same way as rival lines `[decided]` (cockpit answer, 2026-09-29). Their reference is `<packId>:station/<stationId>#<trackId>` (see [Radio stations](#radio-stations-reserved)).
- Lint: veto-able item ids are unique within their entry, and nothing live references a vetoed item.

### IDs and references

- An `id` is lowercase kebab-case (`kevin-from-accounting`), unique within its type inside a pack, and equal to the filename.
- **A bare id refers to the same pack.** A reference into another pack is qualified as `<packId>:<id>`, for example `base:lead-pipe`, and that pack must be listed in `dependencies`. Bare ids never fall through to dependencies. Silent fall-through lets two packs shadow each other, which is the classic mod-conflict bug.
- Reference fields say what they point to in their name, for example `bike`, `startingWeapon`, `crew`, `region` and `route`. The linter knows each field's target type and checks that the target exists.
- Renaming an id: add `"old-id": "new-id"` to `idAliases` in `pack.json`. Never reuse a retired id for something different.

### Units and axes

- **Stored numbers are SI, and the unit is in the field name**: `topSpeedMps` (metres per second), `bustRadiusM` (metres), `windupS` (seconds), `massKg` (kilograms), `latDeg` (degrees). Milliseconds are allowed for feel-tuned durations (`hitStopMs`, `…DurationMs`), because those are tuned by eye in ms. The display unit (mph or km/h) is a player setting `[decided]` and never appears in data.
- **Timing fields become ticks.** The sim runs at a fixed 60 Hz ([architecture](./architecture.md#fixed-timestep-and-the-loop)). Every `…S` or `…Ms` timing field is converted once at load to whole ticks, `ticks = max(1, round(seconds * 60))`, and all checks on timing (such as the steal window) use the tick values.
- Unitless 0–1 values end in nothing and are documented as `0..1` in the schema, for example `aggression`.
- Money is an integer number of in-game dollars: `priceCash`, `fineCash`.
- Road space follows [the architecture doc's coordinates](./architecture.md#coordinates): `s` is distance along a road in metres, from its `from` junction to its `to` junction. `d` is the lateral offset in metres, **positive to the right** when facing increasing `s`. Curvature `kappa` is in 1/metres and **positive when the road turns right** (toward positive `d`). `grade` is rise over run (0.05 means 5 %). `bankRad` is positive when the surface tilts down toward positive `d`. The `kappa` and `bankRad` signs are `[default]` extensions of the architecture doc's `d` rule. Sign conventions are defined in one place in code (the `road/` module), and both docs link to that rule rather than restating it differently.
- World space for road geometry is the architecture doc's per-region transverse Mercator frame ([one world coordinate system](./architecture.md#one-world-coordinate-system)): metres, `x` east, `y` up (true elevation), `z` south, so north is `-z`. The frame is anchored at a WGS84 origin given in the region's network file. A flat local tangent plane is not used because over a region as long as the Keys the Earth's curvature would put far roads hundreds of metres off the plane (the architecture doc computes about 785 m at 100 km). This is the "one GIS coordinate system" call, which the maintainer delegated `[decided]` and which is a `[default]` choice.

### Optional fields keep M1 files short

Almost every field beyond the core few is optional, with a default documented in the schema. An M1 bike file can be eight lines. The richer fields in the examples below are what the format *allows*, not what M1 must fill in. See [What M1 needs](#what-m1-needs).

### Which fields count as sim-facing

The registry computes a **sim content hash** over only each entry's sim-facing fields, and a **full content hash** over everything ([architecture](./architecture.md#content-registry)). Sim-facing fields are the ones that enter `SimConfig`: a bike's `handling` and `combat`; a rider's `stats`, `personality`, `grudge` and `law`; a weapon's timing, reach, damage, knockback, steal and uses; a traffic type's size, speed, hazard and behaviour; events, modifiers, roads and sim-affecting tuning. `look`, `engineSound`, `paint`, `blurb`, `tags` and `meta` are presentation-only and excluded, so a paint or proportion edit never changes the replay key. `src/content/schema/` lists the sim-facing fields per type.

How the list is kept `[default]` (M1 content-1): `SIM_EXCLUDED_FIELDS` in `src/content/schema/entries.ts` names, per type, the top-level fields left out of the sim hash; every other field counts as sim-facing. So a rider's `bike`, `role`, `crew` and `startingWeapon` count too, because they decide what enters `SimConfig`, and a field a later lane adds renews the replay key until it is listed, rather than risking replays that silently diverge. Bark sets, HUD layouts and stations are presentation-only. All of a tuning preset's `values` count, since the file does not say which keys affect the sim.

## Asset references

Tag: `[decided]` for the goal (bundle at the start, stream and cache later, "I don't want to be limited in the future"); `[default]` (the coordinator's mechanism, accepted on the blueprint page) that one manifest abstraction is how it is met, and for its shape.

- An **asset id** is the pack-relative path under `assets/` without its extension, for example `models/bikes/putt-scooter` or `audio/barks/kevin/per-my-last-email`. From another pack it is qualified: `base:models/bikes/putt-scooter`.
- Entries hold asset ids in fields ending in `Asset` (`modelAsset`, `portraitAsset`, `audioAsset`). No entry ever holds a URL or a file extension. That keeps "bundled now, streamed later" a config switch.
- The generated `pack.index.json` resolves each asset id to a real file, kind, size and hash, as the manifest entry `{id, kind, source, path, bytes, hash, packId}` ([architecture](./architecture.md#asset-manifest)). The runtime asset loader turns that into a URL. `kind` and the source names come from the architecture doc: sources are `baked`, `remote` and `procedural`.
- `assetSources` in `pack.json` chooses where the bytes live:

```json
{
  "assetSources": {
    "default": "baked",
    "rules": [
      {
        "match": "audio/barks/**",
        "source": "remote",
        "store": "hf-dataset",
        "baseUrl": "https://huggingface.co/datasets/<hf-user>/throttlebrawl-assets/resolve/{revision}/base/"
      }
    ]
  }
}
```

  `<hf-user>` is a placeholder for the maintainer's Hugging Face account, filled in at setup. `{revision}` is not written in the pack: it is filled from the single dataset pin that [the engineering doc](./engineering.md#big-and-generated-assets) keeps, an exact commit and not a branch, so a pack version always means the same bytes and there is only one pin to bump.
- Allowed asset formats `[default]`: `glb` (models), `png` and `webp` (images), `ogg` and `opus` (audio), `json` and `bin` (data). Nothing executable.
- Procedural and code-made assets `[decided]` ("code-made assets first") are referenced by a preset name plus parameters rather than an asset id, for example `"procedural": { "preset": "scooter", "params": { "wheelbaseM": 1.25 } }`. An entry may have both, and a loaded model overrides the procedural one.

## Entry schemas

Tag: per subsection below.

Each schema below shows one realistic example, then notes on the fields. The examples are valid JSON that an agent can copy. Values are placeholders for shape, not balance.

### Bike

Tag: `[decided]` for 3 bikes to buy, each a clear step up, slower bikes as a wanted direction, synthesized engine sound and paint-only customization; `[default]` for how many slow bikes ship in v1, whether they count among the 3, and the field set.

```json
{
  "type": "bike",
  "id": "sunshine-putt-50",
  "name": "Sunshine Putt 50",
  "class": "scooter",
  "tags": ["slow", "scenic", "starter-option"],
  "handling": {
    "topSpeedMps": 20.1,
    "accelMps2": 2.6,
    "brakeMps2": 6.0,
    "steerRateMps": 3.2,
    "grip": 0.55,
    "massKg": 95,
    "airControl": 0.2,
    "wobble": 0.35
  },
  "combat": {
    "hitPowerScale": 0.8,
    "knockbackResistance": 0.4
  },
  "engineSound": {
    "preset": "two-stroke-buzz",
    "cylinders": 1,
    "idleHz": 38,
    "redlineHz": 190,
    "roughness": 0.7
  },
  "look": {
    "procedural": { "preset": "scooter", "params": { "wheelbaseM": 1.25, "deckHeightM": 0.38 } },
    "paintSlots": ["body", "seat"],
    "defaultPaint": { "body": "#f2c14e", "seat": "#3b2b20" },
    "paintOptions": ["#f2c14e", "#7fd1c7", "#f28f8f", "#e8e2c8"]
  },
  "meta": {
    "status": "live",
    "notes": "Kevin's ride, and a slow option for players who want readable fights and the scenery.",
    "provenance": { "origin": "agent", "author": "agent", "createdAt": "2026-10-01" }
  }
}
```

| Field | Notes |
|---|---|
| `class` | `scooter`, `moped`, `dirt`, `rat`, `sport`, `super` or `chopper`, plus the secret joke-ride classes `lawnmower`, `mobility-scooter` and `golf-cart` `[decided]` (the maintainer wants a riding lawnmower, a mobility scooter and a golf cart as secret rides), reserved for M4. It drives defaults, bark targeting (`target.bikeClass`) and traffic-camouflage jokes. Adding a class is a schema change. |
| `handling.*` | The sim's inputs in SI. `steerRateMps` is the maximum lateral speed across the road. `grip`, `airControl` and `wobble` are 0..1. The sim owns what they mean; this doc only fixes their names and units. |
| `combat.*` | Heavier rigs hit harder (the 3DO manual: "The heavier a rider is, the harder he hits"). The final hit power combines the rider's `massKg` and the bike's `hitPowerScale`. |
| `engineSound` | Parameters for the code-synthesized engine `[decided]`. `preset` names a synth patch in code; the numbers shape it. A rider drawn on another class sounds like that class instead (the base pack's [`defaults.engineSoundByClass`](#the-manifest-packjson)). |
| `look` | Paint-only customization `[decided]`: `paintSlots` and `paintOptions`. The model is procedural first, with an optional `modelAsset`. |

Which bikes are *for sale*, and at what price, lives in the career file, not the bike file. The same bike can then be a rival's ride in one pack and a shop item in another.

### Rider (rivals, cops, player presets)

Tag: `[decided]` for personality styles, grudges, local rivals and cops, rivals who may side with or against you, and preset riders; `[default]` for the parameter set.

```json
{
  "type": "rider",
  "id": "tammy-two-stroke",
  "name": "Tammy Two-Stroke",
  "role": "rival",
  "roster": "local",
  "region": "florida-keys",
  "crew": "swamp-kin",
  "tags": ["smoker", "veteran", "dirt"],
  "blurb": "A chain-smoking auntie on a dirt bike.",
  "bike": "brush-hog-250",
  "paint": { "body": "#c0392b", "seat": "#1a1a1a" },
  "stats": {
    "massKg": 72,
    "healthMax": 100,
    "skill": 0.7,
    "toughness": 1.1,
    "power": 1.0
  },
  "startingWeapon": "tire-iron",
  "personality": {
    "style": "scrapper",
    "aggression": 0.55,
    "dirtiness": 0.6,
    "courage": 0.7,
    "riskTaking": 0.8,
    "targetPreference": ["grudge", "player", "leader", "nearest"],
    "preferredSide": "either",
    "chatter": 0.7
  },
  "grudge": {
    "startTowardPlayer": 0,
    "gainPerHitTaken": 1,
    "gainPerTakedownSuffered": 3,
    "gainPerWeaponStolen": 2,
    "decayPerRace": 1,
    "huntThreshold": 4,
    "max": 10,
    "reliefWhenHelped": 2,
    "shareWithCrew": 0.5
  },
  "look": {
    "procedural": { "preset": "rider-stocky", "params": { "helmet": "open-face", "jacket": "denim-vest", "proportion": "exaggerated" } },
    "palette": ["#c0392b", "#f5e6c8", "#2b2b2b"],
    "portraitAsset": "stills/riders/tammy-two-stroke"
  },
  "meta": {
    "status": "live",
    "notes": "Florida local. Sample line: \"Honey, I've passed hearses faster than you.\"",
    "provenance": { "origin": "agent", "author": "agent", "createdAt": "2026-09-29" }
  }
}
```

| Field | Notes |
|---|---|
| `role` | `rival`, `cop`, `player-preset` or `extra` (a background biker). One schema serves all four, so a cop can be hit like any rider `[decided]` and a player preset is just a rider with `role: "player-preset"`. |
| `roster` | `regular` (tours with the circuit) or `local` (belongs to a region). About 4 regulars plus 4 locals per region "sounds right" to the maintainer `[decided]`; which rider goes where is a proposal `[default]`. Either way it is data, not a rule in code. |
| `region` | Required for `local`, absent for `regular`. |
| `stats.toughness`, `stats.power` | Fight stats (playtest 2, 2026-10-02: "Visible personalities", moderate differences shown through how rivals ride and fight) `[default]`. Multipliers from 0.5 to 2, 1 when absent. `toughness` divides the damage and the stagger the rider takes from a hit; `power` multiplies the damage of every hit the rider lands. `healthMax` stays the rider's endurance. Aggression is `personality.aggression`. |
| `personality.style` | A named preset registered in `sim/ai/` (weights, thresholds and a behaviour set; [architecture](./architecture.md#controllers-every-rider-is-driven-the-same-way)). The ids are `heavy-hitter`, `weaver`, `showboat`, `grudge-keeper`, `scrapper`, `crowd-pleaser`, `crew-boss`, `cop` and `racer`; personality styles exist `[decided]`, but the list is `[default]`: the first four are the styles named in [the product spec](./product-spec.md#rivals), and the rest, including `racer` (a pure racer who avoids fights), are additions. The other personality fields override the preset's values, so a new rival can be one line (`"style": "heavy-hitter"`) or fully bespoke. All numeric fields are 0..1. M1 registers two presets, `heavy-hitter` (a brawler who hunts a target and rides alongside it) and `racer` (holds its line and swings only at whoever drifts into reach); any other id falls back to `racer` until its own preset lands `[default]` (M1 ai-1). |
| `personality.weave` | Lane habit, 0..1: how far the rider drifts across its lane (0 holds a line; about 0.8 swerves like a weaver). Added by M1 ai-1 `[default]`, alongside `aggression` (how often it swings and how far it hunts), `dirtiness` (how often a swing is a kick), `courage` (how hurt it can be and still pick a fight), `riskTaking` (how readily it dodges traffic through the oncoming lane) and `chatter` (for barks). |
| `personality.signature` | The rival's one signature move (interview, 2026-10-02: "Visible personalities", moderate stats shown through how rivals ride and fight; the move list and timings are `[default]`). Each move is both a tell you can read and an opening you can punish, and the snapshot's `signature` field shows it to render. The ids: `selfie` (rides no-hands filming himself for about 3 s and cannot swing: Chad), `wave` (waves at traffic and drifts into the oncoming lane: the Mayor), `bell` (a bell swings before every hit he throws: Gus), `counter` (brakes precisely to drop beside whoever hit him, then counterattacks: Kevin), `lag` (twitches, freezes on the throttle, then lurches back: Dial-Up), `ram` (swings wide, then rams: Mother Rust), `slow-burn` (will not fight until hit enough, then never stops: Deacon), `sweet-talk` (rides beside you being nice, then shoves: Tammy), `cut-in` (cuts into the gap in front of you and brake-checks: Juniper Moss), `timber` (head down, charges whoever is ahead in his line: Old Growth) and `pivot` (signals, swaps sides with a burst, then his battery sags: Pivot). Absent: no signature. `sim/ai/signature.ts` runs them; the `ai.signatures` tuning switch (on by default) turns them all off, and so does `ai.styleQuirks`. Timed moves wait out the first 10 s of a race and then come every 8 to 22 s or so, depending on the move; the counter and the bell answer a hit or a swing. |
| `targetPreference` | An ordered list the AI uses to choose whom to fight: `grudge`, `player`, `leader`, `nearest`, `crew-enemy`. |
| `grudge.*` | Grudge points per event and the threshold at which the rider starts hunting. `shareWithCrew` spreads a grudge to crewmates (0..1). Grudges are saved with the career `[decided]` (cockpit answer, 2026-09-29): the rules live here, and from M4 the career profile carries each rival's running totals across play sessions ([the architecture doc's save format](./architecture.md#save-format)). `decayPerRace` is what keeps an old grudge from lasting forever. Cop heat carried between sessions stays later `[decided]`. Grudge values steer the AI's target choice, so they are sim inputs: the resolved grudge table at race start must be part of `SimConfig` and so of the replay header ([architecture](./architecture.md#sim-contract-srcsimapits), whose field list is a minimum the contract owner may extend). |
| `crew` | Optional reference to a crew entry. |
| `look.procedural.params.proportion` | `exaggerated` or `realistic`. The maintainer was unsure ("idk"), so this is a look-test item for M3 and a `[default]`, not a decision. It is an ordinary procedural parameter, so settling it changes data, not the format. The interview (2026-10-02: "Real proportions, loud costumes") settled it for the real rider models, which are built with real proportions. |
| `look.bikeModel`, `look.bikeClass`, `look.palette`, `look.description` | Real riders on real bikes (run W-R; interview, 2026-10-02: "Real models now") `[default]`. Each rider draws as its own model, `models/riders/<rider id>` (scripted in `tools/blender/riders/`, its costume built from this `description`; the file comes from the dataset repo), on a bike model from the base pack's `models/bikes/` (PR #300). `bikeModel` names that bike (for example `bagger`, `touring-flagship`, `cop-moto`, `parking-trike`); without it `bikeClass` picks the class's bike (render's `BIKE_CLASS_MODELS`), and without either a cop rides `cop-moto` and anyone else the model of their sim bike (the Rustbucket 400). `palette` (hex colours) repaints the bike: the first colour its main paint, the third its second paint, the fourth its accent; without one the bike keeps its own colours. A rider whose models have not loaded draws as the code-made boxes. All presentation-only: none of it reaches the sim or the replay key. |

A **cop** adds a `law` block:

```json
{
  "role": "cop",
  "law": {
    "agency": "keys-county-deputies",
    "bustRadiusM": 14,
    "bustDwellS": 1.0,
    "fineCash": 400,
    "pursuitSpeedScale": 1.05,
    "radioVoice": "tired-deputy"
  }
}
```

`bustRadiusM` and `bustDwellS` (how close, and for how long, the cop must stay next to the rider to bust them) are the only source of those two numbers `[default]`; the tuning panel scales them with `cops.bustRadiusScale` and `cops.bustDwellScale` (default 1.0), never overrides. `radioVoice` is reserved and optional; cop radio chatter comes later `[decided]`. The agency is a small entry under `crews/` with `"kind": "law"`, so each region can have its own local law `[decided]` (sheriffs, troopers and so on) with no code change.

`law.habit` (optional; the pitch deck's #11, "Law with a personality", run W-T) `[default]` gives the cop a way of chasing that is his own: `{ "kind": "relentless" | "radar" | "citations" | "budget", ...numbers }`. Every other field is a non-negative number the sim reads by name, and an absent one takes sim/cops' default:

| `kind` | What it does | Its numbers |
|---|---|---|
| `relentless` | The longer he chases (all race), the closer he holds, the sooner he moves in, the more often he swings, and the harder he rides to catch up. | `rampS` (seconds of chasing to reach the top), `maxScale` (his catch-up speed at the top, × his own) |
| `radar` | On patrol, he waits at the route's first long bridge with a radar; a player passing it over the limit is clocked (heat, his siren, the chase), and one under it rides by. | `limitMps`, `rangeM` (how far up the road the radar reads), `minBridgeM` (the shortest bridge he picks) |
| `citations` | He never rams: alongside, he rides out of bumping range. Every `everyS` alongside he writes a citation of `cashEach`; the total is billed at the player's finish. | `everyS`, `cashEach`, `hangBackS`, `alongsideS` (his own spells of hanging back and riding alongside) |
| `budget` | His chasing comes out of a pursuit budget; once it is spent he pulls over for good. | `budgetS` |

A law crew may add `jurisdiction: { "sign": "END OF JURISDICTION. <kicker>" }` (run W-T) `[default]`: in a race whose heat meter runs, the first fielded cop's agency puts that sign up beside the road part-way along the route, and a player who crosses it has his heat cooled and the cops on him pull over. The words are a headline then a kicker, as the road events' warning signs.

### Crew

Tag: `[decided]` that rivals may side with or against you in gang-ups; the maintainer said "maybe a mix of all these" (dynamic and fixed crews), read as simple gang-ups in v1 and deeper crews later. `[default]` that crews are their own entry type, and for the shape.

```json
{
  "type": "crew",
  "id": "swamp-kin",
  "name": "The Swamp Kin",
  "kind": "gang",
  "region": "florida-keys",
  "stanceTowardPlayer": "neutral",
  "gangUp": { "enabled": true, "maxJoiners": 2, "joinRadiusM": 25, "chance": 0.35 },
  "rivalCrews": [],
  "meta": { "status": "live", "provenance": { "origin": "agent", "author": "agent", "createdAt": "2026-10-01" } }
}
```

- Membership is declared once, on the rider (`crew`), never also listed on the crew. Two lists would drift apart.
- `kind` is `gang`, `sponsor-team` or `law`.
- `stanceTowardPlayer` is `hostile`, `neutral` or `friendly`. A friendly crew can side *with* you in a gang-up `[decided]`.
- Deeper crew systems (reputation, factions) are on the idea shelf. New fields can be added as optional without a format bump.

### Weapon

Tag: `[decided]` for the weapon list and the snatch-on-wind-up steal; `[default]` for the field set, including treating punch and kick as weapons.

```json
{
  "type": "weapon",
  "id": "tire-iron",
  "name": "Tire Iron",
  "category": "blunt",
  "behaviour": "melee.swing",
  "tags": ["roadside", "starter"],
  "unarmed": false,
  "reach": { "sM": 1.6, "dM": 1.4 },
  "windupS": 0.34,
  "activeS": 0.1,
  "recoveryS": 0.42,
  "cooldownS": 0,
  "damage": 18,
  "knockback": { "lateralMps": 4.5, "staggerS": 0.35, "takedownBonus": 0.15 },
  "hitStopMs": 70,
  "steal": { "allowed": true, "windowStartS": 0.12, "windowEndS": 0.34 },
  "uses": { "durabilityHits": 12, "charges": null, "dropOnWreck": true },
  "spawn": { "roadsideWeight": 3, "regions": [] },
  "effects": [],
  "sounds": { "swing": "whoosh-heavy", "hit": "clank-meaty" },
  "look": { "procedural": { "preset": "bar", "params": { "lengthM": 0.55 } }, "holdPose": "one-hand-overhead" },
  "meta": { "status": "live", "provenance": { "origin": "agent", "author": "agent", "createdAt": "2026-10-01" } }
}
```

| Field | Notes |
|---|---|
| `category` | `unarmed`, `blunt`, `chain`, `junk`, `shock` or `improvised`. |
| `behaviour` | Required. A registered behaviour id from a closed list in code: `melee.swing`, `melee.wrap` (drags), `taser.stun`, and from run W-T `throw.burst` (thrown; `reach` is then the throw's range ahead and width), `melee.yank` (pulls the target across your line) and `melee.sweep` (hits both sides) ([architecture](./architecture.md#content-registry)). `effects` and the timing fields are its parameters. A genuinely new behaviour is a code change plus a registration; a new weapon that reuses one is data only. |
| `unarmed` | `true` for `punch` and `kick`, which are weapon entries too. Then all combat feel is data, and the tuning panel tunes them the same way. Unarmed attacks cannot be dropped or stolen. |
| `reach` | The reach box `{ sM, dM }`: a hit lands when the target's distance along the road is within `sM` metres and its lateral offset is within `dM` metres of the attacker, on the attacked side ([architecture](./architecture.md#movers-on-the-network)). |
| `windupS`, `activeS`, `recoveryS` | The attack's timing in three phases. The wind-up is the telegraph a player reads. Converted once to whole ticks at load (see [Units and axes](#units-and-axes)). |
| `cooldownS` | Optional, default 0. A pause after recovery before the same weapon may start again (the kick uses it; a request made during a cooldown falls back to a punch, per [M1 combat-1](./milestones/M1.md#combat-1--punch-and-kick-with-real-timing-windows)). Converted to ticks like the other timing fields. |
| `hitStopMs` | The base freeze-frame length. Tuning keys under `combat.*` are **scales** on per-weapon values (for example `combat.hitStopScale`, default 1.0), never overrides. |
| `steal` | The snatch window, in seconds from the start of the wind-up. The linter checks the tick values: `0 <= startTick < endTick <= windupTicks`, so a window that rounds to nothing fails too. That encodes the 3DO rule "To Grab Weapon: C (when opponent is holding it out)" `[decided]`. |
| `knockback` | `lateralMps` is the push across the road; `takedownBonus` (0..1) raises the chance a hit sends the target into traffic. |
| `uses` | `durabilityHits` for breakables, `charges` for a taser-style item; `null` means unlimited. |
| `effects` | A list of structured effects such as `{ "kind": "stun", "durationS": 0.8 }`. It is a closed list in code, so packs cannot invent behaviour the sim does not have. |
| `spawn` | Weight for roadside pickups; an empty `regions` list means every region. A list of region ids (resolved in the weapon's own pack, checked by the linter) lays the weapon only on those regions' roads: in any other race it is carried with roadside weight 0 (run W-T: the Keys' lawn flamingo, the PNW's canoe paddle in `region-pnw`, SF's dead rental scooter in `region-sf`) `[default]`. |

The cop taser would carry `"category": "shock"`, `"tags": ["cop-issue"]`, `"uses": { "durabilityHits": null, "charges": 6, "dropOnWreck": true }` and `"effects": [{ "kind": "stun", "durationS": 0.9 }]`. The research notes that the Saturn manual calls taking a weapon off a cop the easiest way to get one. That is a good reason for the baton and taser to have `steal.allowed: true`.

### Event

Tag: `[decided]` for the four event types, the objectives mix, time of day per event, selectable race length, the cop mix, cash from placing, takedowns, near-misses, airtime, oncoming-lane riding, takedown combos and weapon steals (no bets), and stills-and-text interludes; `[default]` for the shape.

An event has a common part and a `rules` block whose shape depends on `kind`:

```json
{
  "type": "event",
  "id": "keys-t1-sunburn-sprint",
  "name": "Sunburn Sprint",
  "kind": "classic-race",
  "region": "florida-keys",
  "timeOfDay": "golden-hour",
  "lengths": [
    { "id": "short", "route": "overseas-sprint-short", "laps": 1 },
    { "id": "standard", "route": "overseas-sprint", "laps": 1 },
    { "id": "long", "route": "overseas-loop", "laps": 2 }
  ],
  "field": {
    "riders": ["kevin-from-accounting", "tammy-two-stroke"],
    "fillFromPool": { "roster": ["regular", "local"], "count": 6 },
    "rubberband": 0.25,
    "paceMps": 32
  },
  "traffic": { "densityScale": 1.0, "mixOverride": null },
  "cops": { "mode": "every-race", "baseCount": 1, "tierScale": 0.5, "chaosSummon": true, "randomness": 0.3 },
  "rules": {},
  "modifiers": { "pool": "region-default", "maxPerRace": 1, "chanceScale": 1.0 },
  "objectives": [
    { "id": "podium", "kind": "finish-place", "params": { "maxPlace": 3 }, "required": true },
    { "id": "two-takedowns", "kind": "takedowns", "params": { "count": 2 }, "required": false, "rewardCash": 300 }
  ],
  "rewards": {
    "byPlaceCash": [1500, 900, 600, 300, 150],
    "perTakedownCash": 200,
    "perNearMissCash": 25,
    "perAirtimeCash": 40,
    "perOncomingSecondCash": 10,
    "takedownComboScale": 0.5,
    "perStealCash": 60
  },
  "interludes": { "before": "stills/interludes/sunburn-intro", "after": null, "style": "zine-panel" },
  "meta": { "status": "live", "provenance": { "origin": "agent", "author": "agent", "createdAt": "2026-10-01" } }
}
```

`rules` by `kind`:

| `kind` | `rules` fields |
|---|---|
| `classic-race` | none. Point to point versus laps comes from the route's `closed` flag and each length's `laps`, never from a second field. |
| `takedown-hunt` | `targetCount`, `timeLimitS`, `targets` (`any`, or a list of rider ids), `endOnCount` (boolean). |
| `cop-escape` | `escapeBy`: `distance` or `survive`, then `escapeDistanceM` or `surviveS`, plus `startHeat` (0..1) and `copsFromStart`. |
| `grudge-match` | `rival` (rider id), `winBy`: `finish-ahead` or `knockdowns`, then `knockdownsToWin`, plus `grudgeStakes` (grudge points won or lost), and an optional `rule`: the rival's own rule (run W-T, the pitch deck's #14, `[default]`), one of `audit` (each hit the rival lands on you adds a knockdown to the count, capped), `bad-connection` (the rival's connection drops: a modem screech, a second frozen, then he reconnects about 15 m up the road), `collab` (the most style cash at your finish wins, not the place) or `timber` (only traffic and scenery takedowns count). |

- `field.paceMps` is optional: the event's rival race pace in metres per second. Its default is the event tier's rival pace. Rival pace comes from the event, not from the bike, so a slow scooter still keeps up with the pack `[default]` ([the product spec](./product-spec.md#rivals)); the AI reads it, and `buildSimConfig` raises a rival's bike `topSpeedMps` and `accelMps2` to at least this pace. It is a sim input, so it is in `SimConfig` and the sim content hash.
- The `rewards` style fields are optional and default to 0: `perNearMissCash`, `perAirtimeCash`, `perOncomingSecondCash`, `takedownComboScale` (a multiplier on `perTakedownCash` for each further takedown in a combo) and `perStealCash`. They implement the decided style-cash sources (near-miss traffic, airtime, oncoming-lane riding, takedown combos and weapon steals, plus "maybe other stuff"), which the sim reports as `style` events ([architecture](./architecture.md#sim-contract-srcsimapits)). Scored in M2, banked in M4 `[default]`.
- `objectives[].kind` is one of `finish-place` (`params.maxPlace`), `takedowns` (`params.count`), `escape`, `beat-rival`, `style-cash` (`params.cash`) and `ride-branch` (`params.branch`, a route branch id) (run W-Q; a closed list, extended by a contract PR).
- `rules` is checked by `kind` (run W-Q): a `takedown-hunt` needs `targetCount`; a `cop-escape` needs `escapeBy` and then `escapeDistanceM` or `surviveS`; a `grudge-match` needs `rival` (a rider) and `winBy`, and `knockdownsToWin` when it wins by knockdowns. Only a `grudge-match` may carry a `rule` (the closed list lives in `src/core/grudge-rules.ts`).
- `tier` (1 = a career's first) and `finale` (the region's boss event) are optional career fields (run W-Q). A career map places events in tiers ([Career](#career)); the lint warns when an event's `tier` disagrees with its node's.
- `objectives` implement the decided "objectives mix". `required: true` objectives gate advancing; optional ones pay bonuses. "Top 3 to advance" is only a `[default]` example here, never a hard-coded rule, because the maintainer did not pick it.
- `timeOfDay` is one of the region's `timeOfDayOptions`. A `weather` field is reserved for later; the schema accepts it as optional so adding weather is not a format bump.
- `lengths` gives the selectable race length `[decided]`: each option names a route and a lap count. Lap counts above 1 require a `closed` route (a lint rule), so a long option is either a longer point-to-point route or a closed loop with laps. The example's `long` option uses the loop `overseas-loop`.
- `interludes.style` is one of `zine-panel` (rivals), `tv-broadcast` (the league) or `comic-panel`. The maintainer said the mix by context sounds right but was unsure ("idk"), so the styles are tentative `[default]`; adding or dropping one is additive.
- `modifiers` is optional and reserved: which weird-event modifiers may roll in this event. See [Event modifiers](#event-modifiers-weird-events). M1 events omit it.
- `cops.mode` is `none`, `every-race`, `tier-rising` or `chaos-summoned`. `chaosSummon` lets mayhem summon cops even in other modes, and `randomness` jitters counts and timing. That covers the decided mix. `patrolMax` (playtest 2, 2026-10-02) adds a patrol `[default]`: on top of the mix's starters, the race sends 1 to `patrolMax` more cops up the road, each waiting on the shoulder where the field arrives early in the race; the field holds the starters, `patrolMax` and one more in the lot (for a speed trap or chaos). Every v1 event has `"baseCount": 1, "patrolMax": 2` (the maintainer's "every race has one or two cops on patrol"). `heat` (`true` or absent) runs playtest 2's heat meter: chaos raises the player's heat, its tiers bring one more cop, a pursuit pair and a roadblock, and riding clean cools it (sim/cops); every v1 event has it on `[default]`.
- What happens on a bust or a wreck (fines, retries, consequences) depends on the career's failure mode, which lives in `career/` and the profile's `failureMode`, not in pack files. The default is Road Trip `[decided]` (cockpit answer, 2026-09-29), with Classic and Hardcore as later options ([product spec](./product-spec.md#failure-states)). Events carry only the amounts (a `fineCash` on the cop, optional `wreckCostCash` on the event), never the policy.

### Event modifiers (weird events)

Tag: `[decided]` for rare, data-driven race modifiers in all four kinds wanted (nature chaos, human chaos, wasteland weird, league stunts), with room to grow; `[default]` for the shape below; `[default]` that they arrive in M4 or stay on the shelf. **Reserved, not built for M1.** The type name, the folder and the event's `modifiers` field are reserved now so nothing else takes them and the first modifier does not have to invent a shape or be hard-coded.

A modifier is a small entry under `packs/base/modifiers/`:

```json
{
  "type": "event-modifier",
  "id": "hurricane-gust",
  "name": "Hurricane Gust",
  "kind": "nature",
  "tags": ["wind", "keys"],
  "rarityWeight": 3,
  "eligibility": { "regions": ["florida-keys"], "eventKinds": ["classic-race", "cop-escape"], "timeOfDay": [] },
  "trigger": { "atProgress": [0.3, 0.8], "chance": 0.12 },
  "durationS": 20,
  "effects": [
    { "kind": "lateral-gust", "peakMps2": 3.0, "rampS": 2, "side": "random" },
    { "kind": "spawn-hazard", "hazard": "palm-debris", "count": 4 }
  ],
  "announce": { "barkTrigger": "modifier-start", "sign": null },
  "meta": { "status": "live", "notes": "Placeholder numbers; shape only." }
}
```

| Field | Notes |
|---|---|
| `kind` | `nature`, `human`, `wasteland` or `league`. A closed list in the schema that can grow (adding a kind is a minor schema change). |
| `rarityWeight`, `trigger.chance` | How often the modifier is picked from the pool, and the chance per race that it fires at all. Rare by design. |
| `eligibility` | Region ids, event kinds and times of day it may appear in. An empty list means "any". |
| `trigger.atProgress` | Optional race-progress window (0..1) in which it may start. |
| `durationS` | How long it lasts; converted to ticks at load like every timing field. |
| `effects` | A **closed list in code**, the same pattern as weapon `effects`, so packs cannot invent behaviour the sim lacks. The reserved list: `lateral-gust`, `spawn-hazard`, `spawn-convoy`, `traffic-override`, `cash-multiplier-zone`, `bounty-on-player`, `guest-rider`, `show-billboard`, and `set-piece` (built, W-P: see below). A new effect kind is a code change; a new modifier built from existing kinds is data only. |
| `announce` | An optional bark trigger (`modifier-start`, added to the reserved trigger list) and an optional sign id, so the world can react in words. |

**The maintainer's wanted examples**, all placeholders within the [tone guide](./tone-guide.md#hard-lines) (the funeral procession and rocket launch in particular must follow its hard lines):

| `kind` | Wanted examples |
|---|---|
| `nature` | hurricane gust, gator crossing, cold-night iguana rain |
| `human` | parade, funeral procession, spring-break convoy, offshore rocket launch |
| `wasteland` | cult roadblock, runaway boat on a trailer, a UFO billboard that comes true (a `show-billboard` effect followed by a `spawn-hazard`) |
| `league` | a bounty on the player (`bounty-on-player`), double-cash zones (`cash-multiplier-zone`), a guest "celebrity" rider (`guest-rider`) |

Rules:

- An event opts in with `modifiers: { "pool": [ids] | "region-default", "maxPerRace": n, "chanceScale": x }`. `region-default` means every live modifier whose `eligibility` matches; regions do not keep a second list.
- Modifiers change the sim (traffic, hazards, cash), so the roll must be deterministic: it uses its own seeded `modifiers` stream, and the resolved modifiers are part of `SimConfig` and the replay header ([architecture](./architecture.md#event-modifiers)). The `modifierStart` and `modifierEnd` sim events are what the `modifier-start` bark trigger listens to.
- `[default]` (W-P, the maintainer, 2026-10-01b: "events and set pieces") The road set pieces come first, ahead of M4: each region's race opts in with `"modifiers": { "pool": "region-default", "maxPerRace": 2, "chanceScale": 1 }`, and each region pack carries its own `modifiers/` entries with a `set-piece` effect. Its fields: `piece` (`roadwork`, `crash-scene`, `parade`, `hay-spill` or `speed-trap`), `signText` (the warning sign's words, in the same headline-then-kicker form as a billboard, `[decided]` interview, 2026-10-02: a 2-4 word headline that names what is ahead, so the sign comes true a moment later, then a short kicker), `theme` (`keys`, `pnw` or `sf`: the float dressing and the people's look), `person` (`flagger`, `cop-waving`, `marcher-keys`, `marcher-pnw`, `marcher-sf`), and per piece `vehicle` and `vehicle2` (traffic-type ids, bare ids meaning the modifier's own pack), `floats` (a list of traffic-type ids), `marchers` (a count), `inflatable` (a boolean) and `limitMps` (the speed trap's limit). The vehicles they name are ordinary `traffic-type` entries that no region lists in its mix, so traffic never rolls them; parked ones are `oddity` with `cruiseMps` 0. Other effect kinds still wait for M4 or the shelf.
- `[default]` (run W-T, the pitch deck's #9, "weird events that move") Five more pieces, the same `set-piece` effect, still at most `maxPerRace` a race:
  - `boat-slide`: a pickup (`vehicle`) crawls along towing a boat trailer (`vehicle2`, an `oddity`); as racers close in the trailer lets go and the boat slews across the centre line and stops there (the Keys).
  - `log-spill`: a log truck (`vehicle`) sheds `logs` (default 6) that roll to rest across both lanes; riding over one is a hop. `minDownGrade` (a grade, such as 0.02) makes the first half of its placement tries insist on a downhill (the Pacific Northwest).
  - `cable-runaway`: a cable car (`vehicle`) climbing ahead loses its grip as racers close in and rolls back down at them. `needsTag` (here `cable-line`) puts it only on roads carrying that scenery tag; on a route without one it is dropped before the per-race pick, so it never takes the race's slot (San Francisco).
  - `lane-vote`: a gantry over the road shows `leftText` and `rightText`; the side a player rides under (in a race with no player, the first racer through) picks the event `left` or `right` (modifier ids, bare ids matching any pack), which then turns up about 400 m on. Both must be in the race's pool; their room is reserved at the start. A candidate may itself have a chance of 0, so it only ever comes by vote.
  - `animal-crossing`: a crossing guard (`person`, default `crossing-guard`) and `count` (default 4) animals of type `animal` (a qualified traffic-type id, an `animal` or `pedestrian`) crossing the road through the pedestrian system.
  - Any piece may carry `serial`: up to four short all-caps lines on small signs ahead of it, one joke with the punchline nearest the event ("YOUR BOAT / IS NOT / IN THE WATER / CHECK LANE TWO"). With an empty `signText` the serial signs replace the warning sign.
  - Each piece's moment (the unhitch, the runaway, the first log, the vote) fires a `setPieceBeat` sim event for sound, barks and the camera.

### Career

Tag: `[decided]` for about 10 events in 3 tiers with a boss grudge race, 3 bikes, learn-by-riding in event 1, and an ending that plays a next-region teaser and then lets free play continue; `[decided]` (interview, 2026-10-02, round 4: "Network map, tiered"; round 6: "The map") that each region's road network is its career map: events sit on its roads across all routes and all four event types, winning opens nearby roads and the next tier, then the boss, and the career's personality is the map (claiming roads, finding secrets and shortcuts, a set-piece finale per region); `[default]` that this is its own small file per region (`careers/<id>.json`), its shape below (run W-Q), and that the first run is race-first (the maintainer answered "all of the above… maybe race first", and the intro gets iterated on).

```json
{
  "type": "career",
  "id": "keys-circuit",
  "name": "The Keys Circuit",
  "region": "florida-keys",
  "startingCash": 500,
  "startingBike": "rustbucket-400",
  "tutorialEvent": "keys-t1-shakedown",
  "firstRun": "race-first",
  "tiers": [
    { "id": "t1", "name": "Tourist Season", "advance": { "requiredWins": 2 } },
    { "id": "t2", "name": "Hurricane Season", "advance": { "requiredWins": 2 } },
    { "id": "t3", "name": "Off Season", "advance": { "requiredWins": 2 } }
  ],
  "nodes": [
    { "id": "shakedown", "event": "keys-t1-shakedown", "tier": "t1", "at": { "road": "m1-marina-run", "s": 40 }, "opens": ["m1-pelican-bridge"], "claims": ["m1-marina-run"] },
    { "id": "sunburn-sprint", "event": "keys-t1-sunburn-sprint", "length": "standard", "tier": "t1", "at": { "road": "m1-pelican-bridge", "s": 120 } },
    { "id": "drawbridge", "event": "keys-boss-mother-rust-grudge", "tier": "t3", "at": { "road": "m1-long-bridge", "s": 10 }, "requires": ["sunburn-sprint"] }
  ],
  "boss": "drawbridge",
  "secrets": [
    { "id": "boat-ramp", "kind": "shortcut", "at": { "road": "m1-boat-ramp-cut", "s": 5 }, "ref": "m1-standard-run#m1-boat-ramp-cut" },
    { "id": "pirate-radio", "kind": "station", "at": { "road": "m1-conch-row", "s": 300 } }
  ],
  "ending": { "teaser": "stills/interludes/next-region-teaser", "freePlayAfter": true },
  "shop": [
    { "bike": "rustbucket-400", "priceCash": 0, "unlockTier": "t1" },
    { "bike": "gulfstream-750", "priceCash": 6000, "unlockTier": "t2" },
    { "bike": "hurricane-1100", "priceCash": 18000, "unlockTier": "t3" }
  ],
  "unlocks": [
    { "grant": "riding-lawnmower", "when": { "kind": "boss-beaten", "ref": "drawbridge" } }
  ],
  "meta": { "status": "draft", "provenance": { "origin": "agent", "author": "agent", "createdAt": "2026-10-02" } }
}
```

- **The map.** Each `node` is an event placed on the region's network: `at` is a road of one of the region's networks and an `s` along it, `length` picks one of the event's lengths (its first when absent), and `tier` is one of `tiers`. A win `opens` roads on the map (the next races and free play draw from them) and `claims` roads (the map shows them as the player's). `requires` lists nodes to win first, besides the tier gate; a tier opens after `advance.requiredWins` wins in the tier before it.
- **The finale.** `boss` is a node in the last tier, and its event carries `"finale": true` (the region's set piece); no other node's event may.
- **Secrets** are what the map hides: a `shortcut` (a route branch, `ref` `<route>#<branch>`, see [Route file](#route-file-regionsregionroutesidjson)), a hidden `road`, a pirate `station` (interview, round 6), or a `stash`, each at a map point. The profile records the ones found ([architecture](./architecture.md#save-format)). `[default]` (run W-U) A `road` secret is drawn on the map (the career map and the pause screen's) as a '?' at its point until it is found, and the roads its loose `roads` list names are left off the map until then; found, they are drawn and the mark is a found secret's. The Keys' first is Unlisted Key (`m1-unlisted-key`, $500 the first time).
- `firstRun: "race-first"` puts the player straight into `tutorialEvent` on first launch, with the intro kept short and iterated on `[default]`.
- `ending.teaser` plays after the boss is beaten, and `freePlayAfter: true` keeps the game playable afterwards `[decided]`.
- `unlocks` is optional (M4, not a format bump): a list of `{ grant, when }`, where `grant` is a bike or rider id and `when` has a closed `kind` (`boss-beaten` or `event-won`) plus a `ref` to the boss node or an event id. Anything tagged `secret` is absent from the shop and menus until its `when` is met. In the example the secret riding lawnmower joke ride unlocks after the boss, in free play `[default]`.
- **Lint** (`careers`, `tools/career/pack-rules.ts`, a packs:check hook): every node and secret sits on a road of the region's networks, within its length; opened and claimed roads are the region's; each node's event is the region's and has the length it names; tier and node ids are unique, every node's tier exists, a requirement is never in a later tier, a tier has nodes and asks no more wins than it has; the boss is a node in the last tier whose event is the region's only finale. The refs rule checks the region, the bikes and the events. A career file is outside the sim content hash: it picks races, and each race's sim comes from its event.

The names are placeholders within the tone guide. Whether the slow starter or the first shop bike is the default ride is a feel question for playtests, not a format question.

**As built (run W-R, career lane)** `[default]` for every number and name; done, not phone-verified.

- **The files.** `packs/base/careers/keys-circuit.json` (The Overseas Circuit), `packs/region-pnw/careers/pnw-circuit.json` (The Fir County Circuit) and `packs/region-sf/careers/sf-circuit.json` (The Bay Circuit). Each has ten events in its pack's `events/` (`<region>-t<tier>-<name>` and `<region>-boss-<rival>`): three tiers of three, two wins opening the next, and a finale tier holding the boss. Every route of the region carries at least one event, and each region has all four event types: classic races (the region's first race is "finish to win" with a podium bonus; the rest are top 3), takedown hunts that end at their count, cop escapes (survive 45 to 50 s, or ride 2.5 to 3 km, from the moment a cop is on you), and grudge matches to the line or by knockdowns. Rival pace rises by tier (Keys and Pacific Northwest 34, 39, 44 and 46 m/s for the boss; San Francisco 2 lower, its hills being slower).
- **Fields the schema keeps loose, read by `src/career/`:** a career's `paints` (`{id, name, hex, priceCash, unlockTier}`: each region's own colours), `ending.lines` (the teaser's at most 3 captions) and `ending.next` (the region it points to, qualified); a secret's `name`, `cash` (a stash pays it once; any secret with cash pays it when found), `roads` (run W-U: the roads the map hides until a `road` secret is found) and `atFraction` (a pirate station is found where the audio lane plays it: at that fraction of any route of the region); a `beat-rival` objective's `params.orKnockdowns` (a boss beaten either way: to the line, or knocked down that many times).
- **The rules** live in `src/career/race-log.ts`, read from the sim's public events and snapshots (the career never writes sim state, so a race replays the same with or without one): `finish-place`, `takedowns` (any rider, or the `rules.targets` named; `timeLimitS` fails it; `endOnCount` ends the event), `escape` (lost: a bust; won: survived or ridden far enough since the chase began, or lost the cops after 10 s of chase with 8 s clear, or reached the line), `beat-rival` (to the line, or by knockdowns of that rival by you), `style-cash`, `ride-branch`. A grudge match decided early (a knockdown win, the rival home first) ends there.
- **The map's gate** (`src/career/map.ts`): a node is open when its tier is open and every node it `requires` is won; a win claims its road and its `claims`, and unlocks its `opens`; won nodes stay open to replay, and after the boss every node is open (free play).
- **The show** `[default]` (run W-S, career-show lane; interview, 2026-10-02, round 6: "A quiet frame"; round 4: the between-race mix). A career file's loose `show` block holds its words, and `src/career/show.ts` holds the rules: `paper` (`name`, `style`: `rag`, `newsletter` or `blog`, `tagline`), `heads` (headline templates by moment: `boss`, `bust`, `secret`, `down`, `air`, `miss`, `win`, `lose`; `{rival}`, `{n}`, `{secret}`, `{event}`, `{place}` fill them, upper case when written upper case), `asks` (the producer's: `kind` `takedowns`, `style-cash` or `finish-place`, `n`, `cash`, `text`), `gigs` (`name`, `need`: a style kind, `takedowns` or `finish`, `n`, `cash`, `text`) and `texts` (by rider id: `won`, `lost`, `grudge`, with `{event}` and `{g}`, the grudge). `rules` (run W-T, `[default]`) holds the words of each grudge rule's card, by rule id: a `name` and a one-line `line`; the poster on a grudge match's card states its rule (`RULES: THE AUDIT` and the line), and a rule a file leaves out uses the defaults in `src/career/show.ts`. How each rule scores is in `src/career/race-log.ts` (the Audit adds one knockdown per hit the rival lands on you, two at most; the Collab compares your style cash with the rival's when you cross, a tie is not a win; Timber counts only traffic and scenery takedowns), and Dial-Up's Bad Connection is in the sim (`src/sim/ai/signature.ts`: the modem screech warns 0.75 s ahead, he freezes for a second, then reconnects 15 m up his road when the spot is clear, every 6 to 10 s). The producer never asks for style in a Collab. `receipts` (run W-T, the pitch deck's #14: "a world that keeps receipts", `[default]`) holds the words of the boards the world rewrites: `takedown` and `bust` lists of `{id, text, status}`, filled only from recorded facts (`{rival}`, `{vehicle}`, `{road}`, `{n}`; a template naming a fact the receipt lacks is never used). After a career race the profile keeps each rival the player put into a vehicle and each bust, with the road and the spot (`Profile.receipts`, the newest 24); in the region's next career races the nearest board slot within 600 m of each of the 3 newest receipts on that race's roads shows it: a billboard for a takedown (`SNOWBIRD RV 1, KEVIN FROM ACCOUNTING 0.`), a sign for a bust (`INCIDENT SITE #3.`, numbered by the career's busts). Each is vetoable like a sign; its reference is `<pack>:career/<career id>#<template id>`. The stream is a quiet frame: a poster on each event card (up to four faces from the field, a beef line each by grudge: 6 or more speaks the grudge line, 1 to 5 a taunt, none the rider's blurb) and at most one producer ask a race, seeded by the race seed, asked a quarter of the way along the route and judged from then on, never on a career's first race. An ask never repeats a goal the event already sets: no style ask when the event pays its own style bonus, no takedown ask in a hunt, and a place ask only in a race to the line when it asks for a better place than every place the event names (2026-10-03, the skeptic's run W-S finding: a grudge's own "$300 of style" came back as the ask). A race to the line cleared below first reads CLEARED on the results and in the paper's deck, with the `lose` headline (the finishing place); only first place, or a grudge, hunt or escape won, reads won. After a career race the region's paper prints a headline from the biggest moment (a boss down, a bust, a secret, a takedown, two or more jumps, three or more near misses, then the result), and the rival you hurt most and one who beat you home text you. One side gig per region at a time, picked by how many races the career has run, judged silently from the next career race's tally there. The ask and the gig ride into settle as bonus objectives, so the ledger pays them. In a career race the pause screen shows the region's map panel holding your road, with you on it (not in free play, where it crowded the phone's pause screen).
- **In the game** (the career screens, dressed by the career-show lane above): a device whose career has not started goes from the start tap into the Keys' first event (`firstRun: "race-first"`); the menu's Career button opens the map screen (region tabs; the region's map, one panel per road network, drawn from its road data: claimed roads glow, open roads are drawn, locked ones dashed, events are pins, found secrets are marked; the tiers with their event cards; an event's card with what wins it and Ride); the garage (bikes, paint, the backup code); the career results (every dollar, what the map gained, who holds a grudge now), and the next region's teaser after a boss. In a career race the event's objective sits under the position badge and the learn-by-riding prompts at the bottom. The career's bike rides free play too; its grudges ride career races only. The career's code and screens are lazy chunks, so the first-load JavaScript budget holds.

### Traffic type

Tag: `[decided]` for cars, trucks, an oncoming lane, pedestrians and animals that dive away cartoonishly with no gore, and wasteland oddities; `[default]` for the field set, which the architecture doc leaves to content ("vehicle types ... are content", [movers](./architecture.md#movers-on-the-network)).

One entry describes one kind of road user: a car, a truck, a pedestrian, an animal or an oddity. Files live in `packs/base/traffic/`.

```json
{
  "type": "traffic-type",
  "id": "box-truck",
  "name": "Box Truck",
  "category": "truck",
  "tags": ["commercial"],
  "lengthM": 7.5,
  "widthM": 2.4,
  "cruiseMps": 22.0,
  "hazard": "big",
  "behaviour": { "carFollowing": true, "laneChanges": false, "dives": false },
  "look": {
    "procedural": { "preset": "box-truck", "params": { "cargoHeightM": 2.8 } },
    "paintOptions": ["#e8e2c8", "#7fd1c7", "#d9d9d9"]
  },
  "meta": { "status": "live", "provenance": { "origin": "agent", "author": "agent", "createdAt": "2026-10-01" } }
}
```

| Field | Notes |
|---|---|
| `category` | `car`, `truck`, `rv`, `oddity`, `pedestrian` or `animal`. It picks the movement model: `car`, `truck`, `rv` and `oddity` follow a lane with car-following; `pedestrian` and `animal` spawn from `roadsideZone` features and dive away when a rider gets close. |
| `lengthM`, `widthM` | The oriented box the sim uses for contacts and for spawn spacing. |
| `cruiseMps` | The speed it cruises at when nothing is ahead. Oncoming vehicles use the same value toward decreasing `s`. |
| `hazard` | `normal` (a first contact wobbles you) or `big` (hitting one crashes you). |
| `behaviour` | Flags: `carFollowing` (default true for vehicles), `laneChanges` (rare seeded lane changes), `dives` (true for pedestrians and animals). Optional; the category supplies defaults. `[default]` W-P (2026-10-01, "fill the world") adds, all optional: `kerb` (a bicycle, e-bike, scooter or golf cart rides at the kerb, on the shoulder where there is one, and other vehicles pass it in their lane), `weaveM` (a seeded side-to-side weave as it rides, metres either way, at most 1.5: e-scooters), `convoy` (spawns as a convoy of up to this many, 1 to 4, nose to tail: an RV convoy), `strolls` (a pedestrian or animal walks or jogs along the verge instead of crossing) and `chases` (an animal runs after a passing rider a short way along the verge: dogs). `buildSimConfig` copies `laneChanges` and the W-P flags into `SimTrafficTypeDef.behaviour`. |
| `look` | The same shape as a bike's `look`: a procedural preset with parameters first, and an optional `modelAsset`. |

- `traffic.mix[].kind`, `traffic.pedestrians[].kind` and `traffic.animals[].kind` in a [region file](#region) are references to `traffic-type` ids. The linter checks that each exists and that the category fits the list it is in (a `pedestrian` type in `pedestrians`, and so on). A mix entry's own `hazard` is an optional override of the type's; `weight` and `tags` live on the mix entry.
- Oddities are ordinary entries with `category: "oddity"` (or any category plus the `oddity` tag), so wasteland oddities need no code.
- The type's sim-facing fields (`lengthM`, `widthM`, `cruiseMps`, `hazard`, `behaviour`, `category`) are in the sim content hash; `look` and `name` are not.

### Look

Tag: `[decided]` that the look is chosen by a look test after M1, that the zine overlay is a source of visual identity, and that palettes are compared and set per time of day (tentative, "idk"); `[default]` for the entry shape. Introduced in M3 ([M3 content-3](./milestones/M3.md#content-3--look-data)); it is optional, so it is not a format bump.

```json
{
  "type": "look",
  "id": "chunky-lowpoly-zine",
  "name": "Chunky low-poly with zine overlay",
  "style": "chunky-lowpoly",
  "overlay": "subtle",
  "palette": "keys-signature-a",
  "proportions": "exaggerated",
  "meta": { "status": "draft", "notes": "Illustrative combination for the M3 look switcher." }
}
```

| Field | Notes |
|---|---|
| `style` | A registered `LookStyle` id: `ps1-authentic`, `chunky-lowpoly`, `comic-cel` or `hazy-painterly` ([architecture](./architecture.md#look-layer-swappable)). |
| `overlay` | `off`, `subtle` or `full`: the zine and photocopy overlay level. |
| `palette` | A palette id, keyed by time of day when the palette entry carries per-time variants. A region's `timeOfDayOptions[].palette` can still override colours. |
| `proportions` | `exaggerated` or `realistic` (the rider proportions look test, tentative). |

`pack.json` `defaults.look` names the shipped default look. Looks are presentation-only, so they are in the full content hash and not the sim content hash.

### Region

Tag: `[decided]` for regions as chapters with local rivals, gangs, law, humor and time of day per event, and a traffic mix that includes wasteland oddities; `[default]` for the shape.

See [Region 1 stub: the Florida Keys](#region-1-stub-the-florida-keys) for a full example. Its fields:

| Field | Notes |
|---|---|
| `networks` | The road networks in this region. v1 has one. |
| `timeOfDayOptions` | Allowed values for an event's `timeOfDay`, each with a lighting preset name: `dawn`, `noon`, `golden-hour`, `dusk`, `night`. An option may carry its own optional `palette` that overrides the region's, because the maintainer wants palettes compared and set per time of day (tentative, "idk" `[default]`). |
| `traffic.mix` | Weighted vehicle kinds. Each `kind` is the id of a [traffic type](#traffic-type); the `hazard` class (`normal` or `big`, where hitting a big one crashes you) comes from the type and can be overridden here. Oddities are ordinary entries tagged `oddity`. |
| `traffic.areas` | Optional per-area traffic `[default]` (run W-R; interview, 2026-10-02: "KEYS FIRST = DISTINCT KEYS"): a list of `{ "tag", "mix" }`. Where a road tag named `tag` (a district tag such as `key-fishing`, or any other road tag) covers the spot a vehicle spawns at, that entry's `mix` (the same weighted kinds as `traffic.mix`) replaces the region's mix; a vehicle keeps its kind as it drives on. Where several areas cover the spot, the road's tag listed first wins. Pedestrians and animals keep the region's lists. |
| `traffic.pedestrians`, `traffic.animals` | Weighted kinds (ids of `traffic-type` entries with category `pedestrian` or `animal`) that dive away cartoonishly `[decided]`; `big: true` means hitting one crashes you and overrides the type. |
| `signs`, `billboards` | Objects with an `id`, `text`, optional `tags`, an optional image asset (billboards), and an optional `status` (`live`, `vetoed`, `draft`) so the in-game veto can cut one ([In-game veto](#in-game-veto-cut-this)). Roads place them with `billboard` features, which name an `item` or a `pool` to fill the slot. `[decided]` (playtest 2, 2026-10-02, "pass too fast to read") A board's `text` is a headline plus a kicker: the first sentence is the headline (3-4 words for a billboard, 2-5 for a sign, drawn big enough to read at 100 mph) and the rest is the kicker (drawn small). Write the headline in capitals and keep the joke in the kicker. `[default]` (run W-U) A board tagged `site` belongs to one spot (a junction's KEEP LEFT or KEEP RIGHT, a secret island's name, the airboat tours' billboard by their channel): only the slot that names it shows it, and it never fills a `pool` slot elsewhere. |
| `smashables` | Optional roadside props that break `[default]` (run W-T, the pitch deck's "the road fights back"): objects with an `id`, a `kind` from the closed list in `src/core/smashables.ts` (`lobster-traps`, `mailbox`, `parking-meter`, `pop-up-desk`, `cafe-table`, `firewood-stand`), a `text` that is the takedown's name (a short headline in capitals, at most 32 characters: `CATCH OF THE DAY`), an optional `weight` (1 when absent) and optional road `tags` it stands on (any one; absent means any open road of the region), plus the same optional `status` as signs, so the in-game veto can cut one. The sim places them on the verge beside the road from the race's seed; riding through one smashes it, and a rider knocked into one goes down for a named takedown. They are sim-facing (they enter `SimConfig`). Where a place is satirised, a smashable belongs to an institution or a startup, never to a neighbourhood's own shops (San Francisco's go to startup pop-ups and cafe tables, never Chinatown's shops; all names are invented). |
| `landingLines` | Optional one-liners for a clean landing after real air `[default]` (the pitch deck's #13, "Air that pays": 'TEN OUT OF TEN, SAYS A PELICAN'), shaped like `signs` (an `id`, `text`, optional `status` so "cut this" can cut one). The renderer pops one over the player's bike when a landing gives the surge. Local, deadpan, in capitals, 40 characters or fewer so it reads in a glance. Presentation-only. |
| `palette` | Colour hints for the renderer and UI, so each region has a visual identity. |
| `weather` | Reserved, optional, later `[decided]`. |

**Nothing in a region lists its people or its law.** The registry derives them, so there is one source of truth: local rivals are the riders with `roster: "local"` and `region` equal to this region; local cops are the riders with `role: "cop"` whose `law.agency` is a crew of `kind: "law"` in this region; stations come from each station's `regions` list; modifiers come from each modifier's `eligibility`.

### Radio stations (reserved)

Tag: `[decided]` for radio stations by genre plus regional stations, surf and rockabilly first for the Keys, DJ lines later with the AI barks, and a single original score for M1 and M2; `[default]` for the shape and for the genre list. The maintainer said grunge, surf/rockabilly, stoner/desert and swamp blues all appeal, tentatively ("idk"), so genres beyond surf and rockabilly are placeholders. **Reserved, not built for M1 or M2.**

```json
{
  "type": "station",
  "id": "keys-surf",
  "name": "Surf Radio 24",
  "genre": "surf",
  "regions": ["florida-keys"],
  "tracks": [
    { "id": "reef-break", "title": "Reef Break", "audioAsset": "audio/music/keys-surf/reef-break", "origin": "ai-batch", "status": "live" },
    { "id": "causeway-twang", "title": "Causeway Twang", "procedural": { "preset": "surf-trio", "params": { "bpm": 168 } }, "origin": "agent", "status": "live" }
  ],
  "djBarkSet": null,
  "meta": { "status": "draft", "notes": "Placeholder. Tracks must be original: code-made, or AI-generated under a licence that allows a public game." }
}
```

- `regions` is a list of region ids; an empty list means the whole circuit (a "genre station"), and a non-empty list makes it a regional station.
- `tracks` `[default]` for the shape: each track is an object with an `id` (unique within the station), a display `title`, and either an `audioAsset` (see [Asset references](#asset-references)) or a `procedural` preset for a track written as code. `[decided]` (cockpit answer, 2026-09-29) that tracks come from both routes, code-made and AI-generated, and that the maintainer cuts tracks with "cut this" like rival lines. So `origin` (`agent` for code-made, `ai-batch` for AI-generated, with the batch provenance on the station's `meta` as for bark batches) marks every AI track as AI-generated, and `status` (`live`, `vetoed`, `draft`) plus an optional `note` is how a single track is cut and kept as the taste log. Because the format is still reserved, this shape replaces the earlier plain list of asset ids without a format bump.
- `djBarkSet` is an optional bark-set id for a DJ's lines, filled in later when AI barks arrive.
- `genre` names the band a station plays on, and each track's `procedural.preset` is that band's composer `[default]` (playtest 2, 2026-10-02, "different stations and music in different regions"): `surf` / `surf-trio` and `rockabilly` / `rockabilly-trio` (the Keys), `grunge` / `grunge-band` and `folk` / `folk-band` (the Pacific Northwest), `synth` / `synth-band` and `psych` / `psych-band` (San Francisco); and from run W-Q (interview 2026-10-02 round 6, "More code-made music only") a third band per region and a hidden pirate band per region: `island` / `island-band` and `dub` / `dub-band` (the Keys), `stoner` / `stoner-band` and `ambient` / `ambient-band` (the Pacific Northwest), `funk` / `funk-band` and `chip` / `chip-band` (San Francisco). The regional presets take `bpm`, `key` and `progression` params (the progression ids are in `src/audio/radio-compose-regional.ts` and `radio-compose-more.ts`). A region needs two or more stations of its own to keep its dial to itself; with fewer, the base pack's stations follow its own on the dial.
- `pirate` `[decided]` (run W-Q, interview 2026-10-02 round 6: "a hidden pirate station per region") `[default]` for the shape: an optional `{ "atFraction": 0.55, "radiusM": 320 }` makes a station a hidden pirate. It is never on the dial; the rider hears it only within `radiusM` metres of `atFraction` of the way along the route (a fraction, so it works on every route length of its region), where it takes the radio over (the score too, never a radio that is off) behind a burst of tuning static, and gives it back past the spot. Its `regions` name the region it hides in. `src/audio/pirate.ts` owns the maths. The three pirates are Contraband Cay (the Keys, dub, 55%), Static Cedar (the Pacific Northwest, ambient, 42%) and Zero Day (San Francisco, chiptune, 60%).
- `rider` and `deadAirLine` `[default]` (run W-U, the pitch deck's #5: "When Pivot rides, Pivot FM appears and changes genre every eight bars; knock him down and it goes to dead air, then 'We're excited to announce our next chapter.'"): a station with a `rider` (a rider id, bare ids meaning the station's own pack) is that rider's own station. It is never on the dial; while he rides within 70 m of you it takes the radio over behind the pirate's burst of static (never a radio that is off; a pirate in range wins), and it gives the radio back once he is 130 m off and it has played 8 s. Knock him down (or let him crash) while it plays and it goes to dead air; after 2.5 s it says `deadAirLine` (`<set>#<line>`, a bark line in the same pack, shown and voiced like any bark and cut the same way; its trigger can be `interlude`, which no race event fires), and once he rides again near you the station comes back with its next track. `src/audio/rider-station.ts` owns the timings. Its tracks may use the `pivot-medley` preset: every eight bars the medley pivots to another of the radio's twelve bands (never the same one twice in a row), each part the first eight bars of a real song of that band at its own tempo; `parts` (2 to 12, default 6) sets how many. Pivot FM (`region-sf:sf-pivot-fm`) is the first.
- The M1 and M2 score is not a station: it is one original score made of ordinary audio assets that the audio system plays ([architecture](./architecture.md#audio)). Stations arrive with the radio feature.

### Easter eggs

Tag: `[decided]` that all four kinds are wanted (secret roads and shortcuts, a secret rider or bike, 90s-internet references, real-place gags); `[default]` for the shelf or M4/M5 timing. **No new format is needed.** A secret road is an ordinary road (or a `shortcut` lane) that a route lists in `allowedRoads` and the scenery does not advertise; a secret rider or bike is an ordinary entry that the career does not put on any list, tagged `secret`; references and gags are ordinary bark, sign and billboard lines tagged `easter-egg`, subject to the same veto and the [tone guide](./tone-guide.md). Unlock conditions use the career's optional [`unlocks` list](#career), which is not a format bump.

### Road networks, roads and routes

Tag: `[decided]` for one connected network with along/across coordinates, junctions, streaming, and jumps and ramps in v1; `[default]` for this exact interface.

This is the interface a later **offline GIS pipeline** emits, and hand-authored M1 tracks use the same interface. The runtime never talks to OpenStreetMap or any other source; it only reads baked files. That follows the research: "an offline compiler … bakes a compact game-specific format. The runtime never talks to OSM."

```mermaid
flowchart LR
  A["Hand-authored source: Catmull-Rom control points"] --> C["tools: road compiler"]
  B["Offline GIS pipeline: OSM or TIGER plus USGS elevation"] --> C
  C --> D["Baked road files: network, roads, samples"]
  D --> E["pack validator (in the test step)"]
  E --> F["runtime loader, see architecture.md"]
```

The **baked** format below is the contract, and it follows [the architecture doc's data model](./architecture.md#data-model) field for field: edges with sampled profiles, lane sections with `dCenter`, junctions that own connector edges and a lane-level table, and features as ranges. This doc owns the *file shape*; the architecture doc owns what the sim does with it. How a human writes a road is an authoring convenience compiled into the baked format `[default]`: hand-authored M1 roads are Catmull-Rom control points, as the architecture doc says, and an optional "200 m, gentle left, small hill" segment list may be compiled the same way. The runtime has one road format.

#### Network file: `regions/<region>/networks/<id>.json`

```json
{
  "type": "road-network",
  "id": "keys-m1",
  "name": "Keys M1 coastal loop (hand-authored)",
  "region": "florida-keys",
  "crs": { "kind": "tmerc", "originLatDeg": 24.70, "originLonDeg": -81.10, "originElevM": 0 },
  "chunking": { "kind": "none" },
  "roads": ["overseas-main", "bridge-hump", "ramp-cut", "c-west-main-bridge", "c-west-main-ramp"],
  "junctions": [
    {
      "id": "j-marina",
      "x": 0, "y": 1.5, "z": 0,
      "ends": [{ "road": "overseas-main", "end": "from" }],
      "connectors": [],
      "control": "none"
    },
    {
      "id": "j-channel-west",
      "x": 3800, "y": 2.0, "z": -140,
      "ends": [
        { "road": "overseas-main", "end": "to" },
        { "road": "bridge-hump", "end": "from" },
        { "road": "ramp-cut", "end": "from" }
      ],
      "connectors": [
        {
          "id": "cx-main-bridge",
          "road": "c-west-main-bridge",
          "from": { "road": "overseas-main", "end": "to", "lane": "R1" },
          "to": { "road": "bridge-hump", "end": "from", "lane": "R1" }
        },
        {
          "id": "cx-main-ramp",
          "road": "c-west-main-ramp",
          "from": { "road": "overseas-main", "end": "to", "lane": "R1" },
          "to": { "road": "ramp-cut", "end": "from", "lane": "S1" },
          "splitZone": { "s0": 3760, "s1": 3800, "d0": 2.4, "d1": 4.9 }
        }
      ],
      "control": "none"
    }
  ],
  "provenance": { "origin": "human", "author": "agent", "createdAt": "2026-10-01", "sources": [] },
  "meta": { "status": "live", "notes": "Shortened for the doc: the merge junction j-channel-east and the opposite-direction connectors are omitted; a real network lists all of them." }
}
```

- `crs`: the transverse Mercator frame for every `x`, `y`, `z` in this network (see [Units and axes](#units-and-axes)): metres, `x` east, `y` up, `z` south. A hand-authored network still gets an origin near the place it imitates, so a later GIS bake of the same area lines up.
- `junctions[].ends` lists which road ends meet here; every road has exactly one `from` junction and one `to` junction. A dead end is a junction with one end. `connectors` is the architecture doc's lane-level table: each one maps `(road, end, lane)` to `(road, end, lane)` **through a connector road**, an ordinary short road (usually generated by the compiler and listed in `roads`) so a mover is always on some road, even inside a junction. Whatever is not listed is not a legal turn. A compiler may offer the shortcut "generate connectors for every end pair", but that is an authoring convenience and never a runtime rule.
- **Pass-through joins** `[default]` (M1 app-1): a junction with exactly two road ends and no `connectors` joins them directly, with no connector road. Lanes carry over by `id`, and a mover's overshoot carries into the next road. It is the one exception to "whatever is not listed is not a legal turn", and it is how the M1 track's three roads join end to end.
- `splitZone` (optional, on a connector): a marked stretch of the source road where the rider's lateral position `d` between `d0` and `d1` selects this connector, with no button press, as the architecture doc describes for the ramp shortcut.
- **Connector rows, as built** `[default]` (M1 road-2):
  - A row's `from` road end meets the connector road's `from` end, and its `to` road end meets the connector's `to` end. A row whose lanes have `direction` −1 carries oncoming traffic back from `to` to `from`, so one connector road serves both directions, and the compiler writes one row per drive lane (`R1` and the oncoming `L1`).
  - A connector road runs `from` and `to` the one junction whose rows name it, and it is not listed in that junction's `ends`; its ends are joined by the rows. The ordinary road ends are still listed there.
  - A split zone must reach the end of the source road that the connector leaves from. The runtime decides at that end: a mover whose `d` is inside the zone takes the zone's connector, and every other mover takes the default way on (the connector without a zone, preferring one with no `shortcut` lane).
  - `d` maps across a join by the geometry: the lateral offset of the connector's end point in the road end's frame. So a connector may start off the centreline (the shortcut's starts 3.4 m right of it), and the world position holds across the join. The lane ids in a row name the lanes for traffic and tools.
  - A connector road that leads onto or off a road with a `shortcut` lane carries no `drive` lane, so traffic, which takes only drive-lane connectors, can never reach the shortcut.
- `control`: `none`, `stop` or `signal`, reserved for traffic behaviour.
- `chunking`: `none` for v1. For big GIS regions, `{ "kind": "grid", "cellM": 512 }` tells the baker to split samples into per-cell chunk files (next section). How chunks stream is in [the architecture doc](./architecture.md#chunks).

#### Road file: `regions/<region>/roads/<id>.json`

```json
{
  "type": "road",
  "id": "bridge-hump",
  "name": "Pelican Channel Bridge",
  "realName": null,
  "network": "keys-m1",
  "from": "j-channel-west",
  "to": "j-channel-east",
  "lengthM": 1200,
  "sampleSpacingM": 2,
  "speedLimitMps": 24.6,
  "surface": "asphalt",
  "laneSections": [
    {
      "s0": 0,
      "lanes": [
        { "id": "L1", "dCenterM": -1.7, "widthM": 3.4, "direction": -1, "kind": "drive" },
        { "id": "R1", "dCenterM": 1.7, "widthM": 3.4, "direction": 1, "kind": "drive" },
        { "id": "R0", "dCenterM": 4.15, "widthM": 1.5, "direction": 1, "kind": "shoulder" }
      ]
    }
  ],
  "tags": [
    { "s0": 0, "s1": 1200, "side": "both", "tag": "bridge" },
    { "s0": 0, "s1": 1200, "side": "both", "tag": "water-open" }
  ],
  "features": [
    { "kind": "ramp", "id": "hump-kicker", "s0": 606, "s1": 614, "d0": 0, "d1": 3.4 },
    { "kind": "hazard", "id": "pelican-roost", "s0": 900, "s1": 915, "d0": 3.4, "d1": 4.9, "hazard": "animals", "params": { "animal": "pelican" } },
    { "kind": "billboard", "id": "bb-channel-1", "s0": 380, "s1": 420, "d0": 6, "d1": 9, "item": "timeshare" }
  ],
  "samples": {
    "encoding": "json-columns",
    "columns": ["x", "y", "z", "kappa", "grade", "bankRad"],
    "data": {
      "x": [3800, 3802, 3804],
      "y": [2.0, 2.12, 2.24],
      "z": [-140, -140.008, -140.032],
      "kappa": [-0.004, -0.004, -0.004],
      "grade": [0.06, 0.06, 0.06],
      "bankRad": [0, 0, 0]
    }
  },
  "provenance": { "origin": "human", "author": "agent", "createdAt": "2026-10-01", "sources": [] },
  "meta": { "status": "live", "notes": "Samples truncated to three for the doc; a 1200 m road at 2 m spacing has 601. In these samples y is elevation and z is southward, so a negative z change means the road bends north, a left turn, hence negative kappa." }
}
```

What a road carries:

- **Centreline samples** at a uniform arc-length spacing. The compiler picks `n = round(lengthM / nominalSpacingM)` intervals (nominal `[default]` 2 m, matching the architecture doc; the linter allows a stored spacing of 1–10 m) and stores `sampleSpacingM = lengthM / n` exactly. That gives `n + 1` samples, sample `i` sits at `s = i * sampleSpacingM`, and the last sample sits exactly at `lengthM`, even when the real road length is not a multiple of 2 m. Lint: `count == n + 1` and `abs(sampleSpacingM * n - lengthM) < 1e-6`. Columns:
  - `x`, `y`, `z`: position in the network's frame (`x` east, `y` up, `z` south).
  - `kappa`: signed curvature, positive when the road turns right (see [Units and axes](#units-and-axes)).
  - `grade`: rise over run.
  - `bankRad`: road tilt.
  - An optional `headingRad` may be added.
- **Why position and curvature are both stored:** the sim consumes curvature and grade per step (the classic pseudo-3D "curve and hill"), while rendering, chunking and junctions need positions. The compiler emits both from one smoothed spline, and the linter checks that they agree within a tolerance. The research warns that "curvature must be computed on a smoothed spline, not the raw polyline", so that job belongs to the compiler, never to the runtime.
- **Encodings** `[default]`:
  - `json-columns` for hand-authored and small roads. It is column-wise (one array per quantity, not one object per sample), which is compact and loads straight into typed arrays.
  - `f32-columns` for big baked roads, as `{ "encoding": "f32-columns", "columns": [...], "count": 13831, "dataAsset": "roads/overseas-main" }` pointing to a little-endian Float32 `.bin` asset in the same column order.
  - When chunked, `{ "encoding": "chunked", "chunks": [{ "s0": 0, "s1": 1000, "dataAsset": "roads/overseas-main-c0" }] }`.
  - For scale, the research measured 27.66 km of real highway at 5 m spacing as 5,532 points and about 86 KiB for four float32 columns. At the 2 m default the same road is 13,831 points: about 216 KiB for four float32 columns, or about 324 KiB for the six columns above (computed).
- **Lanes** in `laneSections`, each starting at `s0` and running until the next section starts. That handles a road that widens or gains a shoulder. Each lane is `{ id, dCenterM, widthM, direction, kind }` exactly as the architecture doc's `{dCenter, width, direction, kind}`: `dCenterM` is the lane centre's `d`, `direction` is `1` (with increasing `s`) or `-1` (oncoming, moving toward decreasing `s`, which is the decided oncoming lane `[decided]`), and `kind` is `drive`, `shoulder` or `shortcut`. There is no separate reference line: `dCenterM` already says where `d = 0` sits.
- **Cross-section** `[decided]` (interview, 2026-10-02: off-road "anywhere with ground", rails only on bridges and drops, 4-6 lane highways) with the shape `[default]` (run W-Q contracts):
  - **Lanes per direction**: a two-way section carries 1 to 3 `drive` lanes each way (2 to 6 in all). The lint (`road-cross-section`) refuses a fourth. The GIS bake's `lanesPerDirection` and `medianM` configs write them. `[default]` (run W-R) A hand-made track road may give its own `lanes`, or `laneSections` that change along it (a lane added each way at a time), in `tools/road/tracks/`; lanes carry over a junction by id, so keep the innermost lanes where the neighbouring road has its own. Traffic merges out of a lane that ends. Render draws a road's shoulders at its widest section along its whole length, so start a widening on its own road a little way from the neighbours' scenery (San Francisco's Bridge On-ramp does this).
  - **Median** (optional): `"median": { "widthM": 2, "kind": "paint" | "kerb" | "grass" | "barrier" }` on a section. It is descriptive: the lanes' `dCenterM` already leave the gap, and the lint checks the gap is at least the median's width and that both directions have drive lanes.
  - **Verges** (optional): `"verges": { "left": { "widthM": 6, "surface": "dirt", "edge": "brush" }, "right": ... }` on a section: a band of ground past the outermost lane (its shoulder included). `surface` is `shoulder`, `dirt`, `gravel`, `sand`, `grass` or `kerb`. `edge` says what stops a rider at the band's outer edge: `soft` (the ground runs on), `brush` (ferns or bushes), `water` (a splash), `hard` (a building, cliff or wall), `fence` (smashable) or `rail` (only on bridges and drops: the lint wants a `rail` barrier on that side). A width of 0 means the road's own edge is the edge.
  - **Derived defaults.** A side a section leaves out is derived at each `s` from the road's tags and barriers (`deriveVerge` in `src/road/cross-section.ts`), mirroring what render draws there: a `rail` barrier is a rail edge and a `wall` a hard one; the sea (`water-*`) and a `causeway` are water edges; land tags give ground (palms 4 m sand, beach 6 m sand, forest 6 m dirt ending in brush, row houses 2.5 m kerb ending at the buildings, marina 6 m gravel ending in a fence, and so on); an untagged road is palm land; a dry bridge, or a side whose tags say nothing about the ground, keeps a hard edge. So every existing road has ground beside it without a file change; `tools/road/verges-live.test.ts` checks the defaults against render's land on every live road. `[default]` (run W-R, off-road) The scenery keeps its solid pieces (trees, palms, poles, mangroves, shacks, houses, the sawmill, and the roadside kits' props but their understory) clear of a band of loose ground (`ridableBandPast` in `src/render/scenery.ts`), so nothing a rider would ride through stands where it can ride; a city kerb and pavement keep their street furniture at the kerb. For that, the palm land narrowed from 8 to 4 m (playtest 1's parallax keeps most palms within 8 m of the road), the beach from 10 to 6 m and the sawmill yard from 10 to 6 m. The town, strip-mall, warehouse and pier pavements end `soft`, not `hard`: no building is drawn at their edge, so a wall there would be an invisible one; the row and painted houses' fronts are, so theirs stay `hard`.
  - **Surface**: a road's optional `surface` (`asphalt` when absent; also `concrete`, `brick`, `cobbles`, `gravel`, `dirt`, `sand`, `grass`) is what its lanes are made of. A marked dirt shortcut is a shortcut road with `"surface": "dirt"`.
  - `road/` answers `crossSectionAt(edge, s)`, `vergeAt(edge, s, side)` (the band with its `dInner` and `dOuter` across the road) and `groundAt(edge, s, d)` (the surface under a point, or null past a verge). The closed lists live in `src/core/surfaces.ts`. Not a format bump: every field is optional.
- **Scenery tags** over `s` ranges, per side. The v1 vocabulary is a closed list in the schema, so the renderer can rely on it, and adding a tag is a minor schema change: `water-open`, `water-shallow`, `mangrove`, `beach`, `bridge`, `causeway`, `palms`, `marina`, `strip-mall`, `trailer-park`, `swamp`, `town`, `landmark`.
  - How the renderer reads them `[default]` (playtest 1c, 2026-09-30: scenery stands "on land or verge only; never on bridges, the road or water"): on each side, a `water-*` tag means sea, where boats float offshore; `bridge` or `causeway` alone means no land; any other tag is land, drawn as a strip beside the road (24 m, then a shelf into the sea), with scenery by theme: palms (`palms`, sparser on `beach`), mangrove clumps (`mangrove`, `swamp`), bait shacks and palms (`marina`, `strip-mall`, `trailer-park`, `town`, `landmark`), and power poles along one side of any land. Palms and mangroves grow only on networks with a tropical tag (`palms`, `beach`, `mangrove`, `swamp`), so the Pacific Northwest and San Francisco packs' own tags (`forest`, `row-houses` and the rest) get land and poles but no palms. A road with no tags at all counts as palm land. The scatter derives from the race's seed (playtest 1c item 2), so each race's scenery differs and a fixed seed repeats it. Presentation only: nothing here reaches the sim.
  - **Islets** `[default]` (run W-Q; interview, 2026-10-02, distinct keys; playtest 2: "Maybe islands in the Keys"). On a tropical network's open water (a `water-*` side), little islands float among the boats, 32 to 82 m past the verge, a candidate every 200 m per side (85 % placed), so from every point of every Keys bridge an islet is in sight (the scenery's draw distance, 360 m): a sandbar with palms, a bait shack and a skiff; a sailboat aground; a mangrove clump with a dock and a pelican; a stilt house in the flats (`models/scenery/keys-islets`). Each needs open water 16 m all round (no other road's land near) and water on its own road's side along its length; a boat where one would stand is dropped. One islet kind per 256 m batching square, so they cost a draw per square in sight (7 at most from any Keys bridge point, measured).
  - The region build-out `[default]` (W-O, the maintainer, 2026-10-01: "better visuals and experience"). On a network with no tropical tag the land does not shelf straight into the sea: past its strip a **terrain skirt** slopes down to flat ground just over sea level (about 1 m out per 2.2 m down, then up to 70 m of flat ground, then the shelf). It shortens, or falls back to the shelf alone, where it would bury another road, cover another road's `water-*` side or fold on a tight turn, so a road on a hill never floats in the void. More themes: `forest` grows clustered conifers (four Blender variants), also on the skirt's far ground; `sawmill` stands the sawmill set piece back from the road, with a few conifers; `row-houses`, `painted-houses` and `gardens` line the road with terraces of painted Victorian row houses that face it and step down the hills; `warehouses` and `piers` are land with poles only, for now. On a terrain network a `wall` barrier is drawn as a concrete retaining wall, delineator posts (highways only) stand wherever there is ground beside the road, pylons stand only where a side has none, a network with `forest` stands its `bridge` stretches on timber trestle bents, and a `cable-line` road gets two cable-slot rails down each travel lane. A region's models load only when a race on its network starts.
  - Roadside density `[default]` (run W-P, the maintainer, 2026-10-01b: "the worlds just feel very empty"; "unique regional flavor everywhere"). Each region has a **roadside kit**: one Blender GLB of small props (`models/scenery/<region>-roadside`) and rules in `src/render/roadside.ts` for where they stand, by theme. The Pacific Northwest's (`forest`, `sawmill`, and its `town` and `marina` land): sword fern and salal in a dense band within 2 m of the verge and under the trees, mossy stumps and rocks, split-rail and log fence runs, mailboxes and stacked firewood, a big-footed warning sign gone dark with rain, drive-through espresso huts, and bigleaf maples and red alders among the conifers. San Francisco's (`row-houses`, `painted-houses`, `gardens`, and `warehouses` and `piers` for the kerbside props): parking meters on the house plots, street trees in sidewalk cut-outs, decorative street lamps, hydrants, rental scooters dropped on the pavement, the blue, green and black bins out on collection day, A-frame boards selling AI, AGI and GPUs, cars parked nose to the kerb in the gaps a terrace leaves (one a driverless taxi with a traffic cone on its bonnet), and now and then a corner store; `cable-line` lanes also get cover plates between their slot rails. The Keys' (`palms`, `beach`, `mangrove` and the town tags): sea grape crowding the verge and gone to tree among the palms, pastel conch cottages up on piers behind white picket fences, mailboxes with a fish on top, lobster traps stacked with their buoys, skiffs on their trailers, a pelican on a piling, BAIT ICE boards and a key lime pie stand; the Keys' kit loads with the base pack's models, as the menu's attract scene is the Keys road. A forest road with row houses on it (Twin Peaks) keeps the city's kit. Props are seeded like the rest of the scenery, stand only on drawn land (never on a road, a bridge or the water, or under another road's higher land), keep clear of features and the scenery already standing, and fade by size: the understory to 50 m, middling props to 120 m, trees, huts and fences to 200 m. They are merged per 110 m stretch of road, so a view costs a few draw calls however many props it shows, and the kit and its code load with the region's models, never in the first load.
  - **San Francisco's downtown** `[default]` (run W-R; interview, 2026-10-02: "SF first = downtown towers"; playtest 2: "I expected some city feeling not just all row houses"). Four tags: `towers` (a 3.4 m sidewalk past the verge, then the towers), `plaza` (open paving to 17.4 m, towers behind), `cross-street` and `cable-crossing` (a block's cross street over the tag's span, both sides). The road scene draws their land; `src/render/downtown.ts` draws the rest from the `models/scenery/sf-downtown` kit: the front row of towers shoulder to shoulder with their fronts on the cross-section's hard edge, a taller second row, two screen towers (AGI SOON, SERIES Z), the deadpan headquarters behind the last plaza at the finish, lamps, planters and the city kit's scooters, hydrants and AI boards on the sidewalks, benches and an orb on the plazas, and a city floor out to 300 m. Each cross street runs 200 m off both sides with buildings lining it, zebra crossings and stop lines on the avenue and a signal on each far corner with its arm over the lanes. A `cable-crossing` street climbs the hill on the avenue's left at 16 %, its slot rails run across the avenue, and **a cable car runs on it; nowhere else does one** (playtest 2: cable cars drove "including in forests"; the region's traffic mix no longer carries the cable car). The cross traffic and the cable cars are presentation only: each waits at its stop line while anything on the avenue is nearer than its clearance (60 m plus what a racer at 53 m/s covers while it crosses: about 220 m for a car, 380 m for a cable car), so none is ever on the avenue near a rider. Derived verges (road/cross-section.ts): `towers` 4 m of kerb to a hard edge, `plaza` 18 m of kerb to a soft one, a cross street's mouth 20 m of shoulder to a soft one. Static parts merge per 160 m stretch of road, drawn to 500 m.
  - **District tags** `[default]` (run W-Q; interview, 2026-10-02: "KEYS FIRST = DISTINCT KEYS"). A tag starting `key-` says which key a stretch belongs to and nothing about the ground, so it sits beside the land tags: `key-fishing` (the fishing village: shrimp boats up on blocks, fish houses on pilings, buoy lines, extra trap stacks), `key-resort` (the resort strip: pastel hotels set back behind the poles, pool decks, a tiki bar, rental scooters), `key-junkyard` (the junkyard key: boats racked three high, stacked buses, a junk-art robot) and `key-party` (the party key the morning after: bunting runs, coolers, the closed bar, a deflated flamingo). Run W-U adds `key-secret` (Unlisted Key, the secret island off the sandbar: a tiki bar nobody has found, coolers and a flamingo, none of the conch town's cottages, pickets, mailboxes or pie). A kit rule may name the districts it stands in (`district`) or stays out of (`notDistrict`): conch cottages and pickets stand only off every key (Conch Row), mailboxes stay out of the resort, junkyard and party keys. On keys-m1 the Marina Run, the Marina Bends and the boat-ramp cut are the fishing village, the Sandbar Causeway the resort, Tarpon Flats the junkyard and the Last Resort Causeway the party key; each key has its own signs and billboards, tagged with its district in the region file, standing on that key. Each key also has its own traffic `[default]` (run W-R), in the region's `traffic.areas` keyed on the same district tags: shrimp trucks and pickups towing boats by the fishing village; rental scooter riders, convertibles and golf carts on the resort strip; Salvage Key wreckers and the Salvage Key shuttle bus on the junkyard key; party vans and coolers on wheels on the party key. The six new vehicles are in no region mix, so they appear only on their own key.
- **Features** are ranges in road space, and the vocabulary is exactly the architecture doc's list: `ramp`, `gap`, `hazard`, `roadsideZone` (pedestrian and animal spawns, landmark set dressing), `copSpawn`, `raceMarker` (event start points and, later, world race markers) and `billboard`. A `billboard` feature is a slot (used for signs too): its `item` names one specific billboard or sign id in the region file, or a `pool` (`billboards` or `signs`) lets the game fill the slot from that list. Either way the shown item has a stable content reference, so the in-game veto can name it ([architecture](./architecture.md#in-game-veto-cut-this)). Jumps and ramps are in v1 `[decided]`, including one ramp shortcut. A `ramp` is **baked into the elevation samples by the compiler** (a lip in the profile, from which the sim detects takeoff, as the architecture doc says); the feature record only marks its range, for AI, audio and the lint below. There are no launch-angle or landing fields, so there is one ramp model, not two. The shortcut itself is a separate short road with a `shortcut` lane, entered through a connector with a `splitZone` and rejoining through another junction.
- **Boost pads and the ramp truck** `[decided]` (playtest 1b quick wins, 2026-09-30), with the field shapes `[default]`:
  - A `boostPad` is a box in road space. A grounded rider who rides into it gets a short speed boost and one `boost` event. `params.boostMps` is the speed added (default 8) and `params.holdS` how long the boost lasts (default 1.5 s). The snapshot shows the seconds left as a rider's `boostS`.
  - A `rampTruck` is a parked car-carrier tow truck whose rear deck is a jump ramp. `s0` is the foot of the ramp, `s1` the truck's front bumper, and `d0`..`d1` its width. The deck rises from the road at `s0` to `params.lipHeightM` (default 2.8 m) over `params.rampLengthM` (default 11.5 m, a 13.7° slope). Past a short lip platform (0.45 m at the defaults) the truck is its body, the car parked on its top deck and the cab, solid to `s1` with its top at the model's car roof (1.16 m above the lip at the defaults; both scale with the ramp as render scales the model) `[default]` (the integration skeptic's F2: the old level deck to `s1` let a slow rider roll along inside that car). Nobody rides or lands on the body: a rider who leaves the lip fast enough to clear the truck (about 10 m/s at the defaults) flies over it; a slower one hits it, and a rider who crawls up the ramp bumps the parked car; both are thrown off (a crash, then the tumble's usual hand-back, which never leaves a rider stood in the truck). It faces riders travelling toward increasing `s`; riding into its side or front higher than a kerb is a barrier contact. The truck is a second ramp model beside the baked `ramp`, on purpose: a baked lip spans the whole road, so traffic would drive into it, while the truck covers only its own width, which is placed off the traffic lanes. It is not baked into the elevation samples, and the sim adds the deck to the surface only for riders. The jump lint below applies to it as to a `ramp`.
  - Both are drawn by render from the road's `features`, like `billboard` slots. Placeholder geometry until the props are ready.
  - **Placed by the race seed** `[default]` (playtest 1c item 2, [decided] 2026-09-30: "ramp truck in the same place"). A pad or truck with `params.slot` (a string) is one candidate for that slot, network-wide. Each race's seed picks exactly one candidate per slot, and the others are not there that race. A pad or truck without a slot is always there. The pick is `chooseSetPieces(edges, seed)` in `road/` (its own hash stream, so no other seeded roll moves), and `setPieceActive(feature, chosen)` says whether a feature is there; the sim, render and tools all use it, so a seed always means one placement and replays stay identical. Not a format bump: `params` was already free-form. Every candidate must pass the lints on its own, since any of them may be picked.
  - **The live slots, as built** `[default]` (the integration skeptic's mustFix 1: until now no live track had a slot, so the truck and pads never moved). On keys-m1, pnw-c1 and sf-hills every pad and truck is one of 2 or 3 candidates: the Keys truck on the Pelican Channel Bridge at s 620 or s 1090 (the causeway has no straight long enough for its flight) and three pad slots of two spots each; the Pacific Northwest truck at three spots along the trestle's straight, the landing pad at two spots and the sawmill sprint pad at three; the San Francisco truck at two spots on Painted Row's straight and two pad slots of two spots each. Three rules hold for every slot, checked by `tests/sim/road-setpieces-live.test.ts`: a slot's candidates are all one kind and on the same race lengths (so a seed never drops a piece from a length); no pad candidate lies within 400 m of route before any truck spot (a boosted approach over-throws the truck, see the pelican bridge note in the track source); and a truck spot is straight from its foot to 100 m past the truck. The test also rides every candidate solo on a seed that picks it (each truck spot jumps at the lip and lands clean; each pad boosts once) and on one that does not (open road).
- **Barriers** `[default]` are an optional `barriers` list on a road file: `[{ "s0": 0, "s1": 1200, "side": "left" | "right" | "both", "kind": "rail" | "wall", "heightM": 1.0 }]`. Adding it is not a format bump. A `rail` lets a tumble body that is above `heightM` cross it (the funny splash over a bridge rail `[decided]`, see [Crash tumble](./architecture.md#crash-tumble)); a `wall` does not. Water is the region's sea level, world `y = 0` in the network's frame; there is no per-road water height. `road/` answers `barrierAt(edge, s, side)`. Lint: barrier ranges lie inside `0..lengthM`. `[decided]` (interview, 2026-10-02: "rails only on bridges and drops; posts only on highways") Render draws a `rail` span only where a `bridge` tag covers it or the road stands clear of the ground (a drop); a rail span over level ground is not drawn. Delineator posts line only a highway, a road with four or more drive lanes in some stretch; the two-lane roads have none.
- `realName`: the real road name when the road follows one, such as the Overseas Highway. `null` for invented roads.
- **Junction continuity** is checked by the linter: a road's first sample must lie within 0.5 m of its `from` junction, and its last sample within 0.5 m of its `to` junction. At a junction with connectors `[default]` (M1 road-2), the ends it lists must lie within 60 m of its point, because the connector roads span the junction; instead, each connector's end must meet the road end its row joins: within 0.5 m along the road and vertically, inside that road's width, and pointing the same way within 3°.
- **Jump lint** (from the architecture doc): `ramp` and `gap` features must sit on stretches whose curvature over the expected flight length is below a threshold, because an airborne body "bends with the road" in road coordinates. As built `[default]` (M1 road-2): `|kappa|` must stay at or below 0.002 (a 500 m radius) from the feature's start to its expected landing. For a ramp, the expected landing is where a bike leaving the ramp's highest sample at 44.7 m/s (the starter bike's top speed, 100 mph since playtest 1; M1's was 38 m/s), on the slope just before it, meets the surface again; for a gap, 20 m past its end. The grade rule skips ramp ranges, since a lip is a deliberate kink.
- **Ramps, as built** `[default]` (M1 road-2): the compiler bakes a ramp as a kicker that rises `heightM` over `lengthM` with a steepening slope (`y = h·u²`), then a back that drops to the base over `backM`, with the lip moved onto a sample so the sampled surface keeps its full height. The M1 boat ramp rises 1.5 m over 15 m, a 20 % lip.

#### Route file: `regions/<region>/routes/<id>.json`

```json
{
  "type": "route",
  "id": "overseas-sprint",
  "network": "keys-m1",
  "start": { "road": "overseas-main", "s": 40, "dir": 1 },
  "finish": { "road": "bridge-hump", "s": 1180 },
  "mainPath": ["overseas-main", "bridge-hump"],
  "allowedRoads": ["overseas-main", "bridge-hump", "ramp-cut", "c-west-main-bridge", "c-west-main-ramp"],
  "checkpoints": [{ "road": "overseas-main", "s": 2000 }],
  "closed": false,
  "startGrid": { "rows": 4, "perRow": 2, "rowGapM": 8 },
  "meta": { "status": "live" }
}
```

This matches [the architecture doc's races-as-routes model](./architecture.md#races-as-routes): a start, a finish, an **allowed road set** (the main path plus legal shortcuts and the connector roads between them) and optional checkpoints. Race progress is measured by the runtime as distance to finish over every allowed road, so the ramp shortcut counts as progress and leaving the set does not.

- `mainPath` lists road ids in order; consecutive roads must connect through a junction connector, and every `mainPath` road must also be in `allowedRoads`. The linter checks both. As built `[default]` (M1 road-2): `mainPath` lists the ordinary roads, not the connector roads between them; consecutive roads join by a pass-through join or by a row without a split zone, and that row's connector road must be in `allowedRoads` too.
- **Distance to finish, as built** `[default]` (M1 road-2): the main path's roads and the connector roads between them measure the distance along the main path. Every other allowed road (a shortcut and its connectors) measures the true distance forward along itself to where it rejoins, plus the rejoined road's distance there. So distance to finish falls steadily along either path and never rises: a rider who takes the shortcut gains its saving the moment it enters the shortcut's connector (its race position can jump then), and a rider who stays on the main path sees no jump. Progress is the route length minus the distance to finish.
- A route with `closed: true` loops; **lint: `laps > 1` in an event length requires a `closed` route.** Selectable length is a shorter or longer route, or a closed loop with a lap count, as the architecture doc says.
- A route is the only thing an event needs from the network, which keeps races as "routes through one network" `[decided]`.
- **Branches** (run W-Q; `[decided]` that races get junction choices and marked dirt shortcuts, interview, 2026-10-02: "junction choices in races", and round 5's "marked dirt shortcuts (sandbars, fire roads, clear-cuts)"; `[default]` for the shape). Every split zone on the main path that leads onto allowed roads is a **branch**, picked by the rider's position in the zone (no button), and its roads are the allowed, off-main-path roads reachable from it, connectors included. A route may name its branches, optionally:

  ```json
  "branches": [
    { "id": "sandbar", "roads": ["c-sandbar-in", "sandbar", "c-sandbar-out"], "kind": "shortcut", "marked": true, "sign": "SANDBAR: NOT ADVISED." }
  ]
  ```

  - `id` is stable within the route; the career records found shortcuts and secrets by it. `kind` is `shortcut` (shorter to the finish), `detour` (longer, for something on it) or `alternate` (about the same length); left out, it is derived from what the branch saves (more than 15 m either way, `ROUTE_BRANCH_ALTERNATE_M`). `marked: false` makes it a secret, found by riding it; `sign` is the deadpan sign at the split.
  - A **marked dirt shortcut** is a branch whose roads have `"surface": "dirt"` (or `sand`, `gravel`, `grass`): the branch's surface is its longest road's.
  - A branch the route does not name is still a branch, derived with the id of its first non-connector road, `marked`, and the derived kind. `[default]` (run W-R) A hand-made track names a branch with `named` on its source (`tools/road/tracks/`), and the compiler writes it into every route that allows it; keep the id it would derive, so nothing keyed on it changes. The Keys boat-ramp cut, the PNW logging spur and the SF stair alley are named and signed on all 7 hand-made routes, each with a matching sign standing on the right before its split ("BOAT RAMP: KEEP RIGHT. Trailers only. Nobody checks."; "LOGGING SPUR: KEEP RIGHT. Shorter by a hill. Longer by a log truck."; "STAIR ALLEY: KEEP RIGHT. No vehicles. Especially yours."); the 5 stretch-bake routes have none, and the real-road networks name theirs (below; `tools/road/branches-live.test.ts`). The career map refers to them as `route#id`, which is why the ids stay the derived ones. Run W-R also added marked dirt shortcuts (interview, 2026-10-02: "marked dirt shortcuts (sandbars, fire roads, clear-cuts)"), named the same way, each with a deadpan sign that is also a billboard at the split. The Keys' `m1-sandbar-flats` is a sand track across the shallows north of Tarpon Flats, off the left at the end of the Mangrove Cut (since run W-U, of its last piece, the Mangrove Reach) and back at the foot of Conch Row (about 50 m shorter, over a hummock; the standard and long routes, so the Keys' Long race and the career's longer Keys events). San Francisco's `sf-park-cut` is a dirt path across a park on the inside of the corner, off the end of Painted Row and out at the foot of the bridge on-ramp (about 30 m shorter, and flat where the Fogline Climb rises 22 m; the standard route). Their split and merge connectors are cut from the road they skip, so every other road and feature keeps its place, and a route checkpoint on the skipped road moved off it. **A route that passes a split must take its branch** (`tools/road/branches-live.test.ts`): the sim's junctions pick a split by position, and a crashed rider's body lands on the nearest road, whatever the route allows, so a branch whose merge lies past a shorter route's finish strands a rider there. That rule left no safe place for the Pacific Northwest's fire road yet: from the trestle the standard race passes its split, and round Fogline Ridge the ridge crosses any line a fire road could take. It waits on routes that honour their allowed roads at junctions and in the tumble.
  - **The Mangrove Boardwalk and a branch off a branch** `[default]` (run W-U; the pitch deck's #7, the Keys' rest: "a mangrove boardwalk with airboats alongside, and a secret island"; interview, 2026-10-02, round 2: "mangrove back roads (airboats, gators, shacks)", "a secret island"). The Keys' Mangrove Cut is now five pieces (the Mangrove Cut's first 200 m, the boardwalk's split connector, the Mangrove Bend, its merge connector, the Mangrove Reach; the curve is unchanged), and `m1-mangrove-boardwalk` (named, `alternate`, signed "BOARDWALK: KEEP LEFT. Planks rated for one tourist.") runs across the chord of the bend's bow through the swamp: about 547 m against the bend's 650, but on planks (ridden as `brick`, 5 % slower, since the surface list has no wood), mangroves on its left and the open channel on its right, where the airboats run (a road side tagged `airboats`, drawn by `src/render/airboats.ts`). A road tagged `boardwalk` is drawn as planks. A branch source may now leave and rejoin a road of an **earlier branch** (its `roads` then hold middle pieces marked `connector`, junctions with a through row per lane), and may pass through **`via` points** (`{x, z, headingDeg, turnM}`: a turn, a straight and a turn between each pair, so it can bow out past a chord). Such a branch is part of its parent: the routes allow it with the parent and list its roads under the parent's name; it is never named itself. The first is **Unlisted Key**, the secret island: an unpainted fork off the left of the marked Sandbar Flats (its connectors are tagged `secret`, which render reads: no zone paint, no chevrons), past a "NOTHING OUT THERE. Keep right." sign, looping about 110 m out across the shallows to a palm island with a tiki bar (district tag `key-secret`) and back onto the sandbar, about 70 m longer. The career finds it by riding it (a `road` secret, below).
  - Lint (`route`): every branch road exists, is in `allowedRoads`, is not on the main path, and is in one branch only; ids are unique.
  - At runtime `RouteProgress.branches`, `branchAt(edge)` and `orientation(edge)` (the direction along an edge toward the finish: a rider's `road.dir` times it is 1 racing and -1 after a U-turn) carry them to the sim, which puts each rider's `branch` and `routeDir` in its snapshot.
- **Real-road networks, as built** `[default]` (run W-S; interview, 2026-10-02: "map-based networks (career races drawn from each region's network)", "junction choices in races", "multi-lane highways"). `tools/gis` bakes a network from the real map (`tbgis network`, [tools/gis/README.md](../tools/gis/README.md#networks-real-roads-joined-at-real-junctions)): several real roads joined at their real junctions, each pinned back onto the map where it meets another (the smoothed line drifts off the real one, about 6 m per city block and tens of metres over kilometres, so a loop would not close), with the same junction format as the hand-made tracks: a junction piece of the main road (its main-through connector, one row per drive lane both roads have), a turn-off connector with the split zone, and a rejoin connector, each carrying one `shortcut` lane so traffic stays on the main road, which carries it. The branch's own roads keep their real lanes and carry no traffic. Two so far, each with a four-lane highway and one junction choice: **Key West** (`osm-keys-key-west`, base pack): the Overseas Highway over Stock Island and Cow Key Channel, then South Roosevelt Boulevard along Smathers Beach to Bertha and Atlantic, where four lanes narrow to two in the race direction (the riders' lane-drop funnel's first live use), to Higgs Beach; the choice is North Roosevelt Boulevard, right at the Triangle and back down Truman Avenue and White Street, a shortcut of about 170 m. Its busiest view (Stock Island, looking west at the Triangle, where US 1 runs straight on into North Roosevelt) costs 77 of the still scene's 80 draw calls. **I-5 by Lake Samish** (`osm-pnw-samish`, region-pnw): Interstate 5 southbound over the Chuckanut Mountains, four lanes and a grass median; the choice is Lake Samish's north and east shore roads, off at exit 246 and back on at the Nulle Road on-ramp, an alternate about 250 m longer. Their junctions sit a little off the real gores (the bake's `shiftM`), so the connectors stand in for the ramps' first stretch beside the main road. Each network's route is in the region's route picker and carries a career event (Key West: Chad Speedwell's grudge match; I-5: Deputy Lindqvist's cop escape). Every network keeps its own frame origin.

#### Provenance and licence of road data

Tag: `[decided]` that the maintainer finds the licences of these data sources "all basically fine"; `[default]` for the fields and for the compliance approach below.

Every network and road carries `provenance.sources`. The GIS pipeline fills them in:

```json
{
  "provenance": {
    "origin": "gis-pipeline",
    "author": "tools/gis",
    "createdAt": "2026-11-02",
    "tool": { "name": "tools/gis/bake_road.py", "version": "0.1.0", "configRef": "tools/gis/configs/keys-overseas.json" },
    "sources": [
      {
        "name": "OpenStreetMap",
        "spdx": "ODbL-1.0",
        "attribution": "© OpenStreetMap contributors",
        "url": "https://www.openstreetmap.org/copyright",
        "query": "way[\"ref\"=\"US 1\"][\"highway\"](24.54,-81.82,25.20,-80.35); out geom tags;",
        "retrievedAt": "2026-11-02T03:10:00Z",
        "sha256": "<hash of the raw extract>"
      },
      {
        "name": "USGS 3DEP elevation",
        "spdx": "LicenseRef-US-Public-Domain",
        "attribution": "Map services and data available from U.S. Geological Survey, National Geospatial Program.",
        "url": "https://www.usgs.gov/3d-elevation-program",
        "query": "1/3 arc-second tiles covering the road buffer",
        "retrievedAt": "2026-11-02T03:12:00Z",
        "sha256": "<hash>"
      }
    ],
    "modified": true,
    "modifications": "spline-smoothed, resampled at 2 m, elevation low-pass filtered and exaggerated x2, straights compressed"
  }
}
```

- Three source families are expected: **OSM** (ODbL 1.0), **US Census TIGER/Line** (public domain; the research quotes "Copyright protection is not available for any work of the United States Government"), and **USGS The National Map / 3DEP** (public domain; the requested credit is "Map services and data available from U.S. Geological Survey, National Geospatial Program."). Hand-authored roads have `sources: []`.
- **OSM-derived road files use an `osm-` filename prefix**, which the manifest's `licenseRules` match to put them under ODbL with attribution. A baked stretch's network and route files carry the same prefix and the same rule, since they hold OSM-derived data too `[default]` (gis-1). This follows the research's low-cost compliance move: keep baked tracks under ODbL with an attribution file, publish the preprocessing script, and keep the game code on its own licence. The research is explicit that this is its reading and not legal advice; how ODbL applies to a game asset is (unverified).
- TIGER/Line® is a Census Bureau trademark. Credit the data, but never use the name in branding.
- **The credits screen is generated from the data.** The loader collects every distinct `attribution` from the loaded packs' `licenseRules` and sources. For games, the OSMF attribution guideline allows "a splash screen … the credits page, in the menu", with a link "in an easily locatable part … (e.g. in the menu under "Data licences")". Nobody hand-maintains the credits.

### Bark sets and line selection

Tag: `[decided]` for contextual, non-repetitive tagged lines with memory (grudge history), text bubbles in M1, offline AI batches first, and the maintainer's veto plus taste log; `[default]` for the fields and the algorithm.

**Staging `[default]`.** This section is the full design, not the M1 build. M1 barks need only: trigger match, a per-line cooldown, a no-repeat ring and a weighted pick. `when` conditions, specificity scoring, career-long novelty and memory facts arrive in M2 or later. Text-only lines for `race-start`, `overtake` and `hit-landed` are enough for M1.

A bark file holds many short lines, usually one file per speaker or per AI batch:

```json
{
  "type": "bark-set",
  "id": "kevin-core",
  "defaults": { "speaker": "kevin-from-accounting", "cooldownS": 90, "weight": 1 },
  "lines": [
    {
      "id": "kevin-pass-email",
      "trigger": "overtake",
      "target": "any",
      "text": "Per my last email: move.",
      "audioAsset": null
    },
    {
      "id": "kevin-grudge-invoice",
      "trigger": "grudge-spotted",
      "target": "player",
      "when": [
        { "fact": "grudge.speakerTowardTarget", "op": "gte", "value": 4 },
        { "fact": "history.takedowns.targetOnSpeaker", "op": "gte", "value": 1 }
      ],
      "weight": 3,
      "text": "I'm billing you for the last bridge. Itemized.",
      "audioAsset": "audio/barks/kevin/billing-you"
    },
    {
      "id": "kevin-scooter-shame",
      "trigger": "overtaken",
      "target": "player",
      "when": [{ "fact": "target.bikeClass", "op": "in", "value": ["scooter", "moped"] }],
      "chance": 0.6,
      "text": "Passed by a scooter. HR will hear about this."
    },
    {
      "id": "kevin-first-meet",
      "trigger": "race-start",
      "target": "player",
      "oncePerCareer": true,
      "priority": 2,
      "text": "New hire? Nobody told me about a new hire."
    }
  ],
  "meta": {
    "status": "live",
    "provenance": { "origin": "agent", "author": "agent", "createdAt": "2026-10-01" }
  }
}
```

#### Line fields

| Field | Notes |
|---|---|
| `id` | Unique within the set. The save file and the in-game veto use the content reference `<pack>:bark-set/<set>#<line>` (see [In-game veto](#in-game-veto-cut-this)) to remember what was heard or cut. |
| `status` | Optional: `live` (default), `vetoed` or `draft`, with an optional `note` for the reason. This is how a single line is vetoed and kept as the taste log. |
| `speaker` | A rider id, or a selector: `role:cop`, `crew:swamp-kin`, `tag:smoker`, or `any`. `defaults.speaker` fills it in for the whole set. |
| `trigger` | A closed list in code, checked by the linter. v1 list: `race-start`, `race-end-win`, `race-end-lose`, `overtake`, `overtaken`, `alongside-idle`, `hit-landed`, `hit-taken`, `weapon-stolen-by-speaker`, `weapon-stolen-from-speaker`, `knocked-down-target`, `knocked-down-by-target`, `takedown-into-traffic`, `near-miss`, `crash-self`, `busted`, `cop-siren`, `grudge-spotted`, `gang-up-join`, `interlude`, and the reserved `modifier-start` (see [Event modifiers](#event-modifiers-weird-events)). Run W-T adds the cop habits, each spoken by the cop whose habit it is: `cop-relentless` (he steps it up), `cop-radar` (he clocks you), `cop-citation` (he writes one), `cop-bill` (your citations, at the finish), `cop-budget-out` (his pursuit budget is spent) and `cop-jurisdiction` (he stops at the END OF JURISDICTION sign). |
| `target` | Who the line is said *to* or *about*: `player`, `any`, a rider id, or a selector as above. |
| `when` | Conditions, all of which must hold. Each is `{ fact, op, value }`; `op` is one of `eq`, `neq`, `gt`, `gte`, `lt`, `lte`, `in`, `has`. **No free-form expressions**: a closed fact list is safe for mods and easy to validate. |
| `chance` | 0..1, rolled after selection so frequent triggers do not chatter. The default is 1. |
| `cooldownS` | The minimum time before *this line* may repeat in a session. |
| `weight` | The base selection weight. The default is 1. |
| `priority` | 0–3; a higher-priority bark may interrupt a lower one in the same bubble. |
| `oncePerCareer` | Say it once, ever. The save file remembers it. |
| `text` | The subtitle and bubble text. The linter warns above 80 characters, because bubbles must be readable at speed on a phone. Subtitles for voices are a decided accessibility item, so every line has text even when it has audio. |
| `audioAsset` | The voiced version's asset id. `[default]` (the maintainer, 2026-10-01: "Voices go in") It follows the line's content reference: `<pack>:bark-set/<set>#<line>` is spoken by `assets/audio/barks/<set>/<line>.ogg` in the same pack, asset id `audio/barks/<set>/<line>`, and the game plays clips by that rule, so the field records the clip and a unit test keeps field and file in step. Absent or null: the line is a silent subtitle. |
| `audioStatus` | `[default]` The voice's own vetoable status, separate from the line's: `live`, `vetoed` (the maintainer cut the voice but kept the words; the clip file is removed, the field and an optional `audioNote` stay as the taste log, and the generator never voices the line again) or `draft` (accepted but not acted on yet: the game finds clips by file, so a draft clip still plays). A line cut with "cut this" (its `status`) loses its voice too. |
| `replyTo` | Reserved: a line id this line answers, for two-rider exchanges later. |

The **fact vocabulary** for `when` is a registry in code; the linter rejects unknown facts. The v1 list:

- **Memory (from the save):**
  - `grudge.speakerTowardTarget`, `grudge.targetTowardSpeaker` (0–10)
  - `history.takedowns.targetOnSpeaker`, `history.takedowns.speakerOnTarget` (career counts)
  - `history.lastRace.targetBeatSpeaker` (boolean)
  - `history.racesTogether`
  - `flags.<name>` (story flags)
- **Race state:**
  - `race.progress` (0..1)
  - `race.position.speaker`, `race.position.target`
  - `speaker.healthFrac`, `target.healthFrac`
  - `speaker.weapon`, `target.weapon`, `target.bikeClass`
  - `heat.level` (0..1)
  - `modifier.kind`, `modifier.id` (reserved; the active weird-event modifier, if any)
- **Setting:**
  - `event.kind`, `region.id`, `timeOfDay`

Grudge points are saved with the career from M4 `[decided]` (cockpit answer, 2026-09-29), and the history counts behind memory lines (takedowns, the last race) are saved with them `[default]`, so memory facts hold across play sessions. Until M4, memory facts read from the current run.

**As built** `[default]` (M2 content-2): the trigger list and the fact vocabulary live in `src/content/schema/vocab.ts`, exported from `content/`. Each fact has a kind: a number (grudges 0–10, history counts, `race.progress`, the `healthFrac`s and `heat.level` 0–1, positions from 1), a boolean (`history.lastRace.targetBeatSpeaker`, and `flags.<name>`, one story flag per name) or a string. `target.bikeClass`, `event.kind`, `timeOfDay` and `modifier.kind` take only the values of their closed lists. `gt`, `gte`, `lt` and `lte` compare numbers; `in` takes a list and every other op one value of the fact's kind. `has` is kept for list-valued facts, and none of the v1 facts is a list, so the linter rejects it until one lands.

#### Selection algorithm

`[default]`. It runs each time a trigger fires for a candidate speaker:

1. **Gate on rate.** Drop the request if the speaker spoke less than `barks.minGapPerSpeakerS` ago (default 6 s), or if a bubble is still on screen, or if any bark ended less than `barks.minGapGlobalS` ago (default 0.5 s), unless the new trigger's priority is higher than the bark on screen. A bubble stays up for `max(2 s, characters ÷ 15 per second)` ([tone guide](./tone-guide.md#writing-rules-default)), so a 42-character line is up for about 2.8 s and at most one bubble is ever shown.
2. **Filter.** Keep lines where:
   - the trigger matches, and the speaker and target selectors match;
   - every `when` condition holds;
   - the set's `meta.status` and the line's `status` are `live` (or `draft` in dev builds);
   - the line is not on its own `cooldownS`, not in the speaker's recent-history ring (default size 12), and not a spent `oncePerCareer` line.
3. **Score** each survivor: `weight × specificity × novelty`.
   - `specificity = 1 + 0.5 × (matched when-conditions) + 1.0 × (matched memory conditions)`, and it is ×1.5 more when the speaker is an exact rider id rather than a selector. Specific, memory-aware lines win when they apply. That is what makes barks feel contextual rather than random.
   - `novelty = 0.5 ^ (times heard this career)`, floored at 0.05. Over a career, lines the player has heard many times fade without ever disappearing.
4. **Pick** one line by weighted random, using a **presentation** random stream (seeded from the race seed, separate from every sim stream). Barks never change the simulation. Replays may show different bubbles than the original race, because selection also reads career state (heard-counts, `oncePerCareer`, memory facts) that changes after the race; that is acceptable.
5. **Roll `chance`.** On a miss, stay silent. Silence is a valid outcome and better than a repeat.
6. **Fall back.** If nothing survived step 2, retry once with `speaker: any` lines for the trigger. If that also finds nothing, stay silent.
7. **Record.** Push the line onto the ring, start its cooldown, and bump its heard-count (and `oncePerCareer` flag) in the career state.

All numbers in steps 1–3 are tuning parameters under `barks.*`, so the tuning panel and tuning presets can adjust them.

#### AI-generated batches

`[decided]` offline generation first, AI tie-in later; `[default]` for the mechanics.

- Each AI batch is its own bark-set file, with `meta.provenance` set to `origin: "ai-batch"` plus `batchId`, `model`, `promptRef` and `generatedAt`. Every line inherits the set's provenance unless it overrides it.
- A batch can be switched off in one edit, by setting the set's `meta.status` to `vetoed`. Single lines are vetoed by setting their own `status` to `vetoed`, which is also what the in-game "cut this" flow ends in.
- Vetoed lines stay in their file as the **taste log**, and the generator reads them as negative examples for the next batch.
- The linter flags near-duplicate text across all sets (normalised text equality, plus a simple similarity threshold), so a batch cannot flood the pool with rephrasings. This check arrives with the first AI batch, not in M1.
- Voiced audio generated offline sits next to the text as `audioAsset`, with its `audioStatus`. It is streamed from the dataset repo through `assetSources` when the files get large. `[default]` (run W-O) The first batch is baked: 247 Opus clips at 24 kbps, about 1.9 MB in all, each fetched only the first time its line is said. `tools/voices` makes them (one consistent voice per rival, from a synthetic reference), and a set's `meta.voice` records the batch, the models, the reference voice and the cast file (`tools/voices/cast.json`). `[default]` (run W-S; the maintainer on the voice picks, interview, 2026-10-02: "I didn't pick voices i thought you were going to. Or it can wait.") A listening pass is recorded on the set as `meta.voice.review`: when, how, how many clips were kept, and which lines were redone or cut. Each redone or cut line says why in its own `audioNote`, so the maintainer can veto any pick later with "cut this" or in chat. The first pass checked all 273 clips with two local Whisper models plus pitch, pace, level and a speaker-similarity check, kept 264, redid 9 free with Kokoro-82M on the dev machine's GPU in the rival's reference voice, and cut none.

### HUD layout presets

Tag: `[decided]` for toggling and moving each element, presets (Full, Classic, Minimal), movable and configurable buttons, and a left-handed mirror; `[default]` for the shape.

```json
{
  "type": "hud-layout",
  "id": "classic",
  "name": "Classic",
  "appliesTo": ["touch", "desktop"],
  "elements": [
    { "element": "speedometer", "visible": true, "anchor": "bottom-left", "offset": [0.03, 0.04], "scale": 1.0, "opacity": 1.0 },
    { "element": "position", "visible": true, "anchor": "top-left", "offset": [0.03, 0.03], "scale": 1.0, "opacity": 1.0 },
    { "element": "health-self", "visible": true, "anchor": "bottom-left", "offset": [0.03, 0.12], "scale": 1.0, "opacity": 1.0 },
    { "element": "health-target", "visible": true, "anchor": "bottom-right", "offset": [0.03, 0.12], "scale": 1.0, "opacity": 1.0 },
    { "element": "minimap", "visible": false, "anchor": "top-right", "offset": [0.03, 0.03], "scale": 0.8, "opacity": 0.85 },
    { "element": "bark-bubble", "visible": true, "anchor": "top-center", "offset": [0, 0.06], "scale": 1.0, "opacity": 1.0 },
    { "element": "touch-attack", "visible": true, "anchor": "bottom-right", "offset": [0.08, 0.10], "scale": 1.2, "opacity": 0.7, "touchOnly": true },
    { "element": "touch-brake", "visible": true, "anchor": "bottom-right", "offset": [0.26, 0.06], "scale": 0.9, "opacity": 0.7, "touchOnly": true },
    { "element": "touch-stick-zone", "visible": true, "anchor": "bottom-left", "offset": [0.0, 0.0], "size": [0.4, 0.7], "opacity": 0.0, "touchOnly": true }
  ],
  "mirror": false,
  "meta": { "status": "live", "provenance": { "origin": "agent", "author": "agent", "createdAt": "2026-10-01" } }
}
```

- `element` is a closed list in code, one per HUD widget or touch control. A new widget is a code change *and* a schema change; a new layout is data only.
- `anchor` is one of nine screen points. `offset` and `size` are fractions of the **short side** of the safe area, so one preset fits a phone in landscape and a desktop window alike.
- `mirror: true` flips left and right for the left-handed option.
- The player's own tweaks are **not** stored in packs. The settings store (see [the architecture doc](./architecture.md)) keeps a per-device diff on top of the chosen preset. "Reset to preset" is then trivial, and an updated preset still reaches players who changed one button.

### Tuning presets

Tag: `[decided]` for the in-game tuning panel with presets from M1 that agents lock in; `[default]` for the shape.

```json
{
  "type": "tuning-preset",
  "id": "example-punchy",
  "name": "Punchy (example)",
  "base": "registry",
  "values": {
    "combat.hitStopScale": 1.2,
    "combat.knockbackScale": 1.25,
    "camera.shakeScale": 0.6,
    "camera.chaseDistanceM": 5.2,
    "steer.responseCurve": 1.4,
    "slowmo.takedownDurationMs": 800,
    "barks.minGapPerSpeakerS": 7
  },
  "meta": {
    "status": "live",
    "notes": "Illustrative example only: the shape of a preset exported from the tuning panel after a playtest.",
    "provenance": { "origin": "agent", "author": "agent", "createdAt": "2026-09-29" }
  }
}
```

The example is hypothetical (an exported preset would normally carry `origin: "human"`); no playtest preset exists yet, and its values are placeholders.

- The **parameter registry** (every tunable key, its type, range, default and unit) is defined once in code, next to the systems that use it. The schema emitter generates `tuning-params.schema.json` from that registry, so an unknown key or an out-of-range value fails the check.
- Keys under `combat.*` that touch per-weapon values are **scales** on those values (`combat.hitStopScale`, `combat.knockbackScale`), never overrides, so a weapon's own numbers stay the base.
- `base` names another preset to inherit from. The reserved id `registry` means the registry's own defaults; it has no file and cannot be used as a filename.
- **The workflow:** the panel has "Copy preset as JSON". The maintainer pastes it into chat, and an agent commits it as a file. Locking in a preset means changing which preset id is the shipped default in `pack.json` (`"defaults": { "tuning": "<preset-id>", "hud": "classic" }`).

## Region 1 stub: the Florida Keys

Tag: `[decided]` for the Florida Keys / A1A as region 1, a coastal highway as track 1, the rivals, local cops, wasteland oddities and animals diving away; `[default]` for every specific name, number and joke below, all of which are placeholders within the tone guide that the maintainer can veto.

File: `packs/base/regions/florida-keys/region.json`

```json
{
  "type": "region",
  "id": "florida-keys",
  "name": "The Keys",
  "chapter": 1,
  "blurb": "One road, too many bridges, and a deputy who has seen everything twice.",
  "networks": ["keys-m1"],
  "timeOfDayOptions": [
    { "id": "dawn", "lighting": "keys-dawn" },
    { "id": "noon", "lighting": "keys-noon-glare" },
    { "id": "golden-hour", "lighting": "keys-golden", "palette": { "sky": "#f6b26b", "water": "#e08a5b" } },
    { "id": "dusk", "lighting": "keys-dusk" },
    { "id": "night", "lighting": "keys-neon-night", "palette": { "sky": "#1b1f3b", "water": "#0f3b4a", "accent": "#ff5fa2" } }
  ],
  "palette": { "water": "#19b5b0", "road": "#44474d", "accent": "#f2c14e", "sky": "#8fd3f0" },
  "traffic": {
    "mix": [
      { "kind": "sedan-rental", "weight": 30, "hazard": "normal" },
      { "kind": "pickup", "weight": 20, "hazard": "normal" },
      { "kind": "rv", "weight": 12, "hazard": "big" },
      { "kind": "box-truck", "weight": 8, "hazard": "big" },
      { "kind": "boat-trailer-rig", "weight": 8, "hazard": "big" },
      { "kind": "tourist-scooter", "weight": 6, "hazard": "normal" },
      { "kind": "golf-cart-convoy", "weight": 3, "hazard": "normal", "tags": ["oddity"] },
      { "kind": "tiki-bar-bus", "weight": 2, "hazard": "big", "tags": ["oddity"] },
      { "kind": "airboat-on-wheels", "weight": 1, "hazard": "big", "tags": ["oddity"] },
      { "kind": "mobility-scooter-fast-lane", "weight": 1, "hazard": "normal", "tags": ["oddity"] }
    ],
    "pedestrians": [
      { "kind": "tourist-with-cooler", "weight": 5 },
      { "kind": "fisherman", "weight": 3 }
    ],
    "animals": [
      { "kind": "chicken", "weight": 6, "big": false },
      { "kind": "iguana", "weight": 5, "big": false },
      { "kind": "pelican", "weight": 3, "big": false },
      { "kind": "alligator", "weight": 1, "big": true }
    ]
  },
  "signs": [
    { "id": "ices-before-road", "text": "BRIDGE ICES BEFORE ROAD. It is 91 degrees." },
    { "id": "next-regret", "text": "NEXT GAS 40 MI. Next regret 2 mi." },
    { "id": "iguana-right-of-way", "text": "IGUANAS HAVE RIGHT OF WAY. Legally unclear." }
  ],
  "billboards": [
    { "id": "timeshare", "text": "PARADISE FOR SALE. Some pieces still above water." },
    { "id": "stream-outfit", "text": "WATCH US WRECK LIVE. New episodes every crash." }
  ],
  "weather": null,
  "meta": {
    "status": "live",
    "notes": "Stub for M1. The M1 network is hand-authored and only inspired by the Overseas Highway; a GIS side-quest lane running since M1 builds the real road in the same format [decided]. In M2 the maintainer rides both and picks; the pick becomes the career's road and the other stays as an alternative route [decided]. The roster split is tentative.",
    "provenance": { "origin": "agent", "author": "agent", "createdAt": "2026-09-29" }
  }
}
```

Notes on the stub:

- **The real roads.** The Keys are strung along US 1, the Overseas Highway, and the maintainer's pick also names A1A. As (unverified) background for the later GIS bake: US 1 runs through the Keys to Key West, crosses long bridges such as the Seven Mile Bridge, and SR A1A has a short stretch in Key West. Whoever writes the GIS config confirms this against the source data.
- **Hills in a flat place.** M1 asks for "a curvy road with hills" `[decided]`, and the Keys are nearly flat. The stub gets its hills from bridge humps and causeway rises, with grade exaggerated for fun. The research's pipeline already expects elevation to be exaggerated (×1.5–3).
- **Local cops.** `keys-county-deputies` is a parody agency on real agency structure (county deputies, state troopers, maybe marine patrol), alongside fully parody forces `[default]`; the maintainer answered "maybe a mix of all". Real place and road names are facts and fine to use as flavour (Keys realism is evocative, not literal `[decided]`), but a real sheriff's office name, badge or logo would impersonate a real organisation in a public game, so none is used. See [Open questions](#open-questions).
- **Local roster.** About 4 regulars plus 4 locals `[decided]` (the split itself is tentative). Which rider is which follows the blueprint's proposed split `[default]`: Tammy Two-Stroke, The Mayor and Mother Rust as locals, and Sgt. Pruitt as the local cop. These are not listed in the region file: each is a rider file with `roster: "local"` and `region: "florida-keys"`, and the registry derives the list. The regulars (Deacon Vane, Dial-Up, Chad Speedwell, Kevin from Accounting) are rider files with `roster: "regular"` and no region.
- **Animals** dive away cartoonishly, with no gore `[decided]`. The alligator is `big: true`, so hitting one crashes you. Species with legal protection, such as Key deer, are left out of the stub `[default]`, so the game is not about hitting endangered animals.
- **Humor** follows the decided register: deadpan signs, satirical billboards, and the streaming outfit that follows the tour. Every line here is a placeholder agents may replace, and the maintainer vetoes.

## Validation

Tag: `[decided]` that checks run on every change and stay fast ("focus on velocity"); `[default]` for the checks.

**One command, one gate step.** `npm run packs:check` runs the validator the loader also uses. It is the single "Packs" row in [the engineering gate](./engineering.md#the-gate-definition-of-done) and runs in the pre-commit hook only when pack files are staged. It must stay fast (seconds), and it adds no other step or ceremony. It does two things:

1. **Schema check.** Every file under `packs/` is parsed as strict JSON and validated with the Zod schema for its `type`, including the cross-field refinements.
2. **Lint.** Checks that a single file cannot see:
   - **References:** every reference resolves to a live entry of the right type; cross-pack references name declared dependencies; nothing points at a `vetoed` entry or item.
   - **IDs:** filename equals `id`; ids are unique per type per pack; `idAliases` point at existing ids and never chain; veto-able item ids (bark lines, signs, billboards, station tracks) are unique within their entry.
   - **Public safety (cheap, so in M1):** display-name fields (`name`, `displayName`, sign and billboard text) must not contain "Road Rash", in line with the decided branding rule. Provenance `author` fields must be roles, not personal names or handles.

   The rest of the lint arrives with the feature that needs it, not before `[default]`:
   - **Assets** (with the first assets): every `*Asset` id exists in the pack index and its format is on the allowlist. File size reuses [the engineering doc's `sizecheck`](./engineering.md#npm-scripts) (1 MB for files in git); files routed to the `remote` store are not in git, so the Hugging Face size and LFS/Xet thresholds are a concern of the upload step, not of this lint.
   - **Roads** (with the first road): samples satisfy the spacing rule above (`count == n + 1`, last sample at `lengthM`); curvature agrees with positions within tolerance; road ends meet their junctions within 0.5 m; lane widths are positive; features and tags lie inside `0..lengthM`; `mainPath` roads connect through junction connectors and sit inside `allowedRoads`; `laps > 1` requires a `closed` route; `ramp` and `gap` features pass the curvature rule.
   - **Weapons:** the steal window sits inside the wind-up, checked on tick values.
   - **Tuning:** keys exist in the parameter registry, and values are in range.
   - **Barks** (with the first AI batch): triggers and facts are in the registries; `text` exists and is 80 characters or fewer (warning); no near-duplicate text across sets; a coverage report shows, per rival, which key triggers (`race-start`, `overtake`, `overtaken`, `hit-landed`, `hit-taken`, `knocked-down-by-target`) have no lines. As built `[default]` (M2 content-2, ahead of the AI batch): the `barks` rule fails an unknown trigger, an unknown fact, and an op or value that does not fit the fact; it warns on a number outside the fact's range and on text over 80 characters. Vetoed lines are skipped. The near-duplicate check and the coverage report still wait for the first AI batch.
   - **Licences** (with the first OSM-derived road): every file is covered by `license` or a `licenseRules` entry; any road with an OSM source matches an ODbL rule with attribution. As built `[default]` (M2 content-2): the `licenses` rule reads each entry's `provenance.sources` (or `meta.provenance.sources`). A source whose `spdx` is neither the pack's `license` nor public domain (`LicenseRef-US-Public-Domain`, `CC0-1.0`) needs a `licenseRules` entry with the same `spdx`, a non-empty attribution and a path pattern that matches the file (`*` stays inside one folder, `**` crosses folders). `packs:check` also fails a rule whose `licenseFile` is not in the pack. The base pack carries a public-domain rule for `tiger-*` files with the Census and USGS courtesy credit, so a TIGER bake needs no manifest change.

Other lanes' rules plug in without editing the validator `[default]` (M1 content-1): a module that exports `packRules` (a list of `PackRule`, typed in `src/content/lint.ts`) and is listed in `HOOK_MODULES` in `tools/packs/run.ts` runs with the built-in rules. The road lane's `tools/road/pack-rules.ts` is listed already and switches on when the file lands. Two reference checks only warn `[default]`. A bark set's `speaker` or `target` naming a rider that is missing, vetoed or draft: such lines simply never play, which cannot break a race, and bark sets may land before their riders' files. And a live entry naming a `draft` one: release builds leave drafts out, so the reference is empty there, which is how a lane keeps unfinished content out of the public game (the M1 traffic types ship as drafts until they are drawn). A reference to a `vetoed` entry or item still fails, and so does a pack default (`defaults.tuning`, `defaults.hud`) that names a draft.

Errors fail the check. Warnings print but pass, so velocity is not blocked by, for example, a slightly long bark. Every message carries a file path and a JSON pointer, such as `packs/base/riders/kevin-from-accounting.json /personality/aggression: expected 0..1, got 1.4`, so an agent can fix it without searching.

The loader runs the **same Zod validators** at runtime in dev builds, and on any pack not shipped with the build (the future mod path). Release builds trust the packs the CI already checked, so for M1 the validators can stay dev-only and be added to the release bundle when outside packs arrive.

## Versioning and migration

Tag: `[default]` that saves and packs are versioned: a coordinator call on something hard to change later, which the maintainer delegated for hard-to-change technical choices `[decided]`; `[default]` for the scheme.

- **Two version numbers.** `version` (semver) says the pack's *content* changed. `formatVersion` (an integer) says the *file formats* changed. The game build declares the `formatVersion` range it reads.
- **When to bump `formatVersion`:** when renaming or removing a field, changing a field's meaning or unit, or making an optional field required. Adding a new optional field with a default does **not** bump it. Most growth, such as weather, crews or new tags, is additive and free.
- **The seam, and nothing more, for now.** Every `pack.json` carries `formatVersion`, and the loader refuses a pack whose `formatVersion` it does not support, with a plain message ("this pack needs a newer game version"), never half-loaded.
- **Until outside packs exist, a format change edits the repo's own packs in the same change.** Before v1 every pack lives in this repo, mods are shelved, and replays are already tied to an exact content hash, so a migration framework would protect nothing. (Save-file migrations are different and are owned by [the architecture doc](./architecture.md#save-format).)
- **Pack migrations** (pure `N → N+1` functions on raw parsed JSON, each with a before-and-after fixture) are built the day the first out-of-repo pack is supported, and not before.
- **Renames** go through `idAliases`, so saves, replays and other packs that name an old id keep working.
- **Saves and replays** record which content they were made with: each loaded pack's `id`, `version`, and a content hash from the generated index. A replay played back against different content still plays, with a warning that it may diverge, because the deterministic sim is only reproducible on identical data. The save format itself belongs to [the architecture doc](./architecture.md); this doc only requires that the record exists.
- **Generated JSON Schema** is built from the current Zod source on demand (see [File format choice](#file-format-choice)), so there are no versioned schema folders to maintain.

## The base game as pack zero

Tag: `[decided]` for data files plus content packs now; `[default]` that base is literally a pack.

- Every piece of content, including punch and kick, the M1 test road and the default tuning, lives in `packs/base`. Game code holds only engines, closed vocabularies (enums such as `element`, `trigger`, fact names and effect kinds) and registries (tuning parameters, style presets, synth patches, procedural presets).
- **Load order:** `base` first, then other packs in dependency order, with ties broken by id. A pack may **add** entries freely. Changing an entry from another pack is a *patch* (next section), shelved for v1.
- **Chapters as packs.** Region 2 and later ship as `region-<name>` packs that depend on `base`. The traveling-circuit lore of "chapters = content drops" `[decided]` maps directly onto packs. Regions are no longer "after v1": the maintainer moved them forward ("I do think we should start adding other regions races etc to avoid over optimizing, keep things fun, ensure everything works"), the Pacific Northwest and San Francisco first ("Pnw and sf first then others"), crude first and reusing everything `[decided]` (playtest 1c, 2026-09-30). They are separate packs, `region-pnw` and `region-sf` `[default]`; the next section is how the game loads them.
- **Build:** the base pack is bundled into the Vite build at the start `[decided]`, via the generated index `[default]`. Streaming it, or any other pack, from the HF dataset repo later is a change to `assetSources` and the loader, not to the content files.

## Region packs at runtime

Tag: `[decided]` that new regions ship now as content packs (playtest 1c, 2026-09-30, above); `[default]` for everything below. The loader is `src/content/packs.ts`; app/ turns a region pick into a race (`src/app/regions.ts`).

**What the build carries.** Every folder under `packs/` is a pack the build carries.

- `base` is bundled into the JavaScript, except its road data. First its **real-road data** (run W-P, `[default]`): the `osm-*` network, road and route files tools/gis bakes from map data (the Keys' Bahia Honda run, about 60 KB of first-load gzip). Those ship beside the build like a region pack's road data, and app/ fetches them in the background at boot, so the route picker offers Bahia Honda a moment after the menu shows. The hand-made Keys road data (its network, roads and routes) ships beside the build as JSON files too (run W-S, `[default]`: about 103 KB of the 500 KB first-load gzip, and the budget had been crossed four times in a day). The default race and the menu's backdrop need it at once, so the page fetches it before the app starts (`loadBootContent`, main.ts) and tries once more if that fails; `loadBasePack()` says so plainly if it is read before that. Node-side callers get the same files from disk: the test setup (`tests/setup/base-roads.ts`) and the build's self-test race (`scripts/selftest-race.ts`) call `provideBaseRoadsFromDisk()`. The bundled base's files and their order are unchanged, so the sim content hash and every replay key hold (the full hash in the browser now counts those files' `meta.notes`, as it always did in Node: the build strips notes only from bundled JSON). Every race's content hash covers base whole, so no race starts until base's real-road data is in (a race started before would record under a replay key that moves when it arrives); Race shows the busy line and retries in the rare case it is not. `loadBasePack()` is this bundled base (entries plus the hand-made road data); Node-side checks of the pack as authored read `src/content/base-pack-whole.ts`.
- Another pack's entry files (its manifest, `region.json`, events, riders, crews, bark sets, traffic types) are bundled into the JavaScript too, so the menu can list its region at once. They are small: about 5 KB gzip per region pack today.
- Its **baked road data** (the `regions/<region>/networks/`, `roads/` and `routes/` files) is not. It ships beside the build as plain JSON files, and the game fetches it the first time a race in that region starts. Road data is most of a region pack's bytes (about 60 KB gzip for the Pacific Northwest, 41 KB for San Francisco, before their real roads landed; with them, 27 files each, about 246 KB and 189 KB counting each file gzipped on its own, 2026-10-01), and the JavaScript budget is 500 KB gzip ([engineering](./engineering.md)), so the budget does not grow with every road. A failed fetch can be retried; the race does not start without its road.

**Combining packs.** Each pack is parsed and validated on its own (`parsePack`), then the packs combine into one registry keyed by qualified id: `base` first, then dependency order, ties by id. A pack whose dependency is not carried, or a pack carried twice, is refused. The semver ranges in `dependencies` are advisory at runtime; the version check belongs to `packs:check`.

**References resolve from the pack that holds them**, exactly as the linter resolves them ([IDs and references](#ids-and-references)): a bare id names an entry of the same pack, a qualified id names that pack. That covers an event's `region`, `field.riders` and length `route`s; a rider's `bike` and `law.agency`; a route's `network`; a network's `roads`; and a region's traffic `kind`s. Every content id the race's `SimConfig` carries is qualified by the pack that defines it (`region-pnw:old-growth`, `base:rustbucket-400`, `region-sf:cable-car`).

**A race's packs** are its event's pack and that pack's dependencies. Only their content reaches the race: the traffic types and weapons in `SimConfig`, the cop pool, and the sim content hash in the replay key. So carrying more region packs never changes a Keys race, its replay or its replay key.

**The menu's region picker** offers one option per region that has at least one loaded event whose `region` names it.

| Picker field | From |
|---|---|
| id | The region's qualified id, `base:florida-keys` |
| name | The region's `name` |
| blurb | The region's `blurb` |
| order | The region's `chapter`, then id |
| event | The first such event by qualified id (one per region today); its `standard` length, else its first |

**Real roads as routes** `[decided]` (the maintainer, 2026-10-01: "Yes, add as routes"), with the rule below `[default]`. A region's real-road routes are the routes in the race's packs whose network was baked from map data (`provenance.origin` is `gis-pipeline`, the `tools/gis` bake) and whose network's `region` is the event's region; the event's own length routes are never among them. app/ lists them with `realRoutes`. A race may run one of them instead of its length's route (`RaceSetup.route`); any other route id falls back to the length's route. The event, its field, cops, traffic, signs and rewards stay the same, so only the road changes. The region's hand-made road stays the default. A region pack's routes are road data, so its real routes are known once its road data is fetched.

**The menu's route picker** `[default]` sits under the region chips ("Which road"). It offers the picked region's event road first, by the event's name (Fogline Run, the default, raced at the Race length setting), then each real road by its route's `name`, in route id order (`routeChoices`). Picking a real road shows its real road or streets and its length in place of the region's blurb (for example "Real streets: Hyde, California, Kearny, Columbus, Union, Leavenworth. 5.3 km."). The chips are full-size touch targets in one row that scrolls sideways when the names do not fit, so the Race button stays on a phone held sideways. A region's real roads appear once its road data is in (picking the region fetches it), the pick resets to the region's own road when the region changes, and the menu backdrop shows the picked road's grid. The real roads today: Bahia Honda Run in the Keys (the gis-1 stretch), Chuckanut Drive and the Columbia River Highway in the Pacific Northwest, Russian Hill and Twin Peaks in San Francisco ([tools/gis](../tools/gis/README.md#the-region-bakes)).

**The field and the law.** Rivals are the event's `field.riders`. Cops for `every-race` come from the race's packs: riders with `role: "cop"`, a `law` block, and a `region` that resolves to the event's region (a cop without a `region` rides everywhere), sorted by qualified id.

**Traffic.** The region's `traffic.mix`, `pedestrians` and `animals` weigh the traffic types. Every other type in the race's packs gets weight 0, so it never spawns. Each `traffic.areas` entry's mix reaches the sim as the types' `areaWeights` by area tag (a type an area does not list gets 0 there).

**Signs and billboards.** app/ builds the renderer's board catalog from the event region's `signs` and `billboards`, leaving out vetoed items (by `status`, or cut on this device). Each item's reference is `<packId>:region/<regionId>#<itemId>` ([In-game veto](#in-game-veto-cut-this)). A road's `billboard` slot names an item of its own region (`item`), or the `signs` or `billboards` pool.

**Palette.** The race's palette is the region's `palette`, overridden key by key by the `palette` of the event's `timeOfDay` option. app/ hands it to the renderer with the time of day (`env.palette`). The keys that name a render material kind are colours for that material: `sky`, `water`, `road`, `shoulder`, `land`, `rail`, `deck`, `markingCenter` and the rest of the list in `src/render/look.ts`. `fog` colours the haze, and a region that names one gets a closer haze (the `render.regionFogFarM` slider, 480 m; it always starts past the 200 m threat distance). Some keys repaint the region's Blender models by role `[default]` (W-O, 2026-10-01): `foliage`, `foliageDark` and `trunk` the conifers, `rowHousePink`, `rowHouseMint`, `rowHouseYellow` and `rowHouseBlue` the row houses' four paints, and `cableCar` the cable car's body. Some set the scene: `fogBank` lays fog banks offshore in that colour (drawn unlit, so they melt into the haze); `rain` turns on a render-only drizzle in that colour (the `render.rainAmount` slider; the schema's `weather` stays reserved, and a palette is not a sim input); `skylight` and `sunlight` tint the light from above and the sun (a dimmer colour is a dimmer light: the Pacific Northwest's overcast). Other keys (`accent`) are hints. The renderer ignores keys it does not know. `[default]` Palettes are written against the classic look: a colour that differs from the classic colour of its kind (from the classic sky at that time of day, for `sky`) replaces that colour in every look, and the ink looks still ink, hatch and grade it. A colour equal to the classic one means "the look's own", which keeps the Keys as they were in every look.

**Backdrop.** `[default]` (W-P "fill the world", the maintainer, 2026-10-01b: "distance and skyline: hills, mountains, city skylines, water, bridges on the horizon") A region's horizon is data in its pack, under `assets/backdrop/<region-id>/`: asset data files, not entries, so the registry, the replay key and both content hashes never see them. The renderer (`src/render/backdrop/`) fetches a region's files the first time a road of that region is shown, never in the first load, and draws all of it as one mesh past the fog.

- `region.json`: `formatVersion` (1), `region`, `hazeM` (the distance at which the far haze hides 63 %), `hazeMax` (the most it ever hides, so the farthest ridges still show), `floorColour` (the far ground or sea all round) and `pieces`.
- `networks/<network-id>.json`: one per road network (a unit test fails when a network has none): `formatVersion`, `network`, the network's map origin (`originLatDeg`, `originLonDeg`, equal to its `crs`, also tested) and optional `pieces` of its own.
- A piece has an `id` and a `kind`: `ridge` (a crest line with heights, snow, clear-cut patchwork and waterfalls), `peak` (a volcano, a dome, twin hills or a monolith), `bridge` (suspension or girder, with towers, piers, a hump and missing spans, and `traffic`: lights crawling across each way), `skyline` (invented towers, a spire, a deadpan glowing orb), `blocks` (low city), `vessels` (container ships, sailboats, a shuttling ferry, a river tug, shrimp boats trawling), `clouds` (thunderheads, banks, a rolling fog bank, fog pouring over a crest), `train` (a freight train on a straight track), `aircraft` (a seaplane coming in to land), `islands`, `lighthouse`, `mast` and `floor` (far land or water). Points are `[lat, lon]` in degrees, put in the network's own transverse Mercator frame exactly as the GIS bake does, or `[x, z]` metres with `"frame": "local"` (for a hand-made network). `networks`, `maxDistM`, `keepOutM` (nothing stands closer to a road), `exaggerate` (sizes "as they read from the road", not survey numbers) and `haze` are common options. The field list is `src/render/backdrop/data.ts`.
- `[default]` (W-T, pitch 6 "the horizon comes alive": "a middle distance that moves") What moves does it on the GPU, with no draw call and nothing per frame: ships, sailboats and fog banks swing to and fro; a train, a seaplane, a bridge's traffic and a pour glide one way end to end, thin into the haze near each end of the run and come round again, so nothing pops. A glide's track must keep `keepOutM` from every road along its whole run, or the piece is left out.
- Fixed landmarks take their shape from their `id`; what varies between races (clear-cuts, waterfalls, islands, boats, clouds) comes from the race's seed. Everything is flat colour that every look's haze and grade applies to: no textures, no crack, rust or grime, no text, and no real brands (the skyline is invented).

**Roadside scenes.** `[default]` (W-T, pitch 6 "the horizon comes alive": "small staged scenes beside the road, each with ONE dry sign"; "signs stay headline-short") A region's staged scenes are one data file in its pack, `assets/scenes/<region-id>.json`: an asset data file like the backdrop's, so the registry, the replay key and both content hashes never see it, and the renderer (`src/render/scenes/`) fetches it with the region's first race, never in the first load.

- The file: `formatVersion` (1), `region`, `everyM` (one scene per this many metres of road at most), `maxPerRace` (default 5) and `scenes`.
- A scene: `id`, `status` (`live`, `draft` or `vetoed`, as signs; only `live` scenes are placed, and a vetoed one stays in the file with its `note` as the taste log), `on` (the side themes it stands on: `water` alone, or land themes such as `forest`, `urban`, `beach`), `acrossM` (how far past the verge its middle stands), `radiusM` (its footprint), `sign` and `parts`.
- `parts` are boxes in the scene's own frame (x along the road, y up from the ground or the waterline, +z toward the road): `box` [w, h, d], `at` [x, y, z], optional `rotX`, `rotY`, `rotZ` and `colour`. `far: true` keeps a part in the far level of detail (the scene's outline).
- `sign`: `text` (all caps, at most 6 words and 32 characters; the first sentence is the headline, the rest a small kicker), `at`, `size`, `bg`, `fg`, and its posts (`post` colour, `posts` 0, 1 or 2). It faces +z.
- Placement is seeded by the race: each scene at most once a race, on its own theme, past the ridable ground band, on the land the road scene drew all across its footprint (a water scene on open water past it), clear of other roads, the road's features and the scenery standing there; the roadside props then keep off its ground. Each scene draws as one mesh with one shared material (the race's signs share one texture), one draw call while it is within the scenery draw distance, and only its `far` parts and its sign past the far detail distance.
- A sign's veto reference is `<packId>:scenes/<regionId>#<sceneId>`; the renderer hides a scene whose reference it is told to hide.

**Rival lines.** Bark sets, like riders, come from the race's packs, so a local rival speaks their own pack's lines. The narrative (ui/) still reads base's bark sets only; reading the combined registry is a ui follow-up.

**Replays and resume.** A recording's header names the qualified event and route (`event.routeId`, a chosen real-road route included) beside the seed, so a replay or a resume rebuilds the road from that region's road data (app/ fetches it first when needed).

**What a region pack needs to be playable**, beyond the [M1 minimum](#what-m1-needs):

- `pack.json` with `dependencies: { "base": ... }`;
- a `region.json` with `name`, `blurb`, `chapter`, `networks`, `timeOfDayOptions` and `traffic`;
- a baked network, its roads and at least one route;
- one live `event` whose `region` is the region, with its lengths, `field` and `cops`.

Local rivals, a local cop with a law crew, bark sets and region traffic types are optional. Without them the race reuses base's riders and traffic by qualified id.

## Later: loading packs from outside (mods)

Tag: `[decided]` that this is shelved ("maybe later") and that the format must not block it; `[default]` for what is reserved.

What the format already guarantees, so mods stay cheap later:

- **Data only.** No code, no expressions, no URLs in entries. The asset formats are allowlisted. A pack can only use behaviour the game already has.
- **Namespaced ids** and declared dependencies, so two packs cannot silently collide.
- **Self-describing files**: `type` in every file, plus the generated index. A zipped pack folder is a complete, checkable unit.
- **Licence and attribution metadata** travel with the pack, so the credits screen stays correct with third-party packs.
- **The validators can run in the browser**, since they are Zod schemas: when outside packs are supported, they ship in the release bundle (for M1 they are dev-only).

Reserved but not built:

- **Patches.** A file with `"type": "patch"`, `"target": "base:lead-pipe"` and a `"merge"` object applies a JSON Merge Patch (RFC 7386) to another pack's entry. It is reserved in the schema now so the `patch` type name cannot be taken by something else.
- **A "Load pack" menu** that reads a zip through a file picker, validates it, and stores it on the device. Size caps and a pack-disable toggle come with it. The runtime side belongs to [the architecture doc](./architecture.md) when it is built.
- **Localisation.** Text fields are plain strings in v1. A later locale pack could patch `text` and `name` fields without a format change.

## What M1 needs

Tag: `[decided]` for the M1 contents (crude everything, including cops and the tuning panel); `[default]` for the minimum field sets.

Every M1 feature is playable from these minimal files. Everything else in this doc is optional and can arrive in later milestones without a format bump.

| Type | M1 minimum |
|---|---|
| `pack` | The `base` manifest with `id`, `version`, `formatVersion`, `license` and `defaults` (`"tuning": "registry"` until the first exported preset is locked in). |
| `bike` | 1–3 bikes with `class`, `handling.topSpeedMps`, `accelMps2`, `brakeMps2`, `steerRateMps`, `massKg`, and `engineSound.preset`. |
| `rider` | 1 player preset, 4 box rivals (`role`, `bike`, `personality.style`), and 1 cop with a `law` block. |
| `weapon` | `punch` and `kick` (unarmed, with `reach`, and `cooldownS` on the kick), plus 1 pickup with a steal window. |
| `event` | 1 `classic-race` with 1 length, a `field` (with `paceMps` when the rivals need a set pace), `cops.mode`, 1 required objective, and `rewards.byPlaceCash`. |
| `region` | The Florida Keys stub: `networks`, one `timeOfDayOptions` entry, `traffic.mix` with cars (the approved M1 list says "traffic cars"); trucks, pedestrians and animals are optional additions. |
| `road-network`, `road`, `route` | 1 hand-authored network (Catmull-Rom control points compiled to baked samples) with a curvy, hilly main road; the approved M1 list asks for "a curvy road with hills". Junctions and ramps are optional in the format; M1 includes one junction and the ramp shortcut ([M1 road-2](./milestones/M1.md#road-2--one-junction-and-the-ramp-shortcut)). |
| `traffic-type` | Cars plus one truck, each with `category`, `lengthM`, `widthM`, `cruiseMps` and `hazard` (see [Traffic type](#traffic-type)). |
| `bark-set` | A few text-only lines per rival for `race-start`, `overtake` and `hit-landed` (text bubbles in M1 `[decided]`), with M1's minimal selection (see the staging note). |
| `hud-layout` | 1 preset. The other presets can follow. |
| `tuning-preset` | None required. `defaults.tuning` is `registry` until the first exported preset is locked in. |
| `event-modifier`, `station` | None. Weird events and radio stations are reserved formats (M4 or the shelf, and later); M1 and M2 ship a single original score, which is one or more ordinary audio assets and not a station. |
| `meta` | Optional everywhere; defaults apply. |

## Open questions

Tag: `[open]` for anything listed as open below; this doc currently has none.

None are currently open for the maintainer.

- **Answered (amendment): local cops' names.** Cops use parody names on real agency structure, plus fully parody forces `[default]`, from the maintainer's "maybe a mix of all". No real agency names, badges or logos. Real road and place names stay as flavour.
- **Answered (cockpit, 2026-09-29): formats touched by the maintainer's answers** `[decided]`. Grudges are saved with the career ([rider `grudge.*`](#rider-rivals-cops-player-presets), [line facts](#line-fields)); radio tracks come from both code-made and AI routes and are vetoable per track ([Radio stations](#radio-stations-reserved)); the failure-state default is Road Trip, which is career policy, not pack data ([Event](#event)).

Everything else in this doc is a technical `[default]` that later lanes may change, following the rules above.
