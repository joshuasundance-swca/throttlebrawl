# M5 diagnostic race scene contract

`[default]` One pure APP helper prepares the scene for the later menu-only diagnostic repeated-race
measurement. It does not create or launch a Sim, load content, collect frames, acquire wake,
change normal settings/seeds/selection or establish phone acceptance.

## Surface and ownership

The following is the complete exported surface of `src/app/measurement-scene.ts` for APP-internal
consumers and its scoped tests. Imported types come from existing module public exports; the
helper owns copies of all metadata and deeply freezes them. Optional members inside ReplayConfig
retain that public type's optionality; none of the outer metadata fields is optional. Do not add
re-exports to `src/app/index.ts` or allow other modules to import this internal file. A later
cross-module consumer requires its own reviewed consumer/barrel contract. The declaration below
specifies the signature; the implementation exports the actual function from this APP-internal file.

```ts
import type { ContentHashes, ContentRegistry } from '../content';
import type { ReplayConfig } from '../replay';
import type { RaceWeather } from '../save';
import type { SimConfig, SimTrafficTypeDef } from '../sim/api';
import type { RegionStream } from '../stream';
import type { Garage } from './race-options';
import type { RaceSky } from './regions';

export type DeepReadonly<T> = T extends readonly (infer U)[]
  ? readonly DeepReadonly<U>[]
  : T extends object ? { readonly [K in keyof T]: DeepReadonly<T[K]> } : T;

export interface MeasurementSceneSelection {
  regionId: string;
  routeId: string | null;
  seed: number;
  garage: Readonly<Garage>;
  bike: string | null;
  timeOfDay: string | null;
  weather: RaceWeather;
}
export type BikeSelectionSource = 'menu' | 'garage' | 'starter';
export type TrafficDirection = 'same' | 'oncoming';
export type CopMode = NonNullable<SimConfig['event']['cops']>['mode'];
export type SeedIssue = 'not-finite' | 'not-uint32' | null;

export interface MeasurementRequestSummary {
  regionId: string;
  routeId: string | null;
  bikeId: string | null;
  garageCurrentBikeId: string | null;
  timeOfDay: string | null;
  weather: RaceWeather;
  seed: number | null;
  seedIssue: SeedIssue;
}
export interface MeasurementTrafficTypeCapability {
  contentId: string;
  category: SimTrafficTypeDef['category'];
  globalWeight: number;
  areaWeights: Readonly<Record<string, number>>;
  initializationCompatible: boolean;
  rollingOddity: boolean;
  usableDirections: readonly TrafficDirection[];
}
export interface MeasurementTrafficCapability {
  inputs: {
    master: number | null;
    same: number | null;
    oncoming: number | null;
    oddities: number | null;
    oncomingEaseInS: number | null;
  };
  clampedDensity: { master: number | null; same: number | null; oncoming: number | null };
  effectiveDensity: { same: number | null; oncomingTarget: number | null; oncomingAtStart: number | null };
  oncomingEase: { enabled: boolean; startFactor: number; finalFactor: 1 };
  enabledDirections: readonly TrafficDirection[];
  types: readonly MeasurementTrafficTypeCapability[];
  capable: boolean;
}
export interface MeasurementSceneDescription {
  requested: MeasurementRequestSummary;
  eventId: string;
  regionId: string;
  route: {
    requestedId: string | null;
    actualId: string;
    networkId: string;
    standardLengthId: 'standard';
    lengthM: number;
  };
  seed: number;
  bike: { intendedId: string; actualId: string; source: BikeSelectionSource };
  field: {
    productLimit: 9;
    eligibleCount: number;
    maximumRivals: number;
    actualRivalIds: readonly string[];
    actualRivalCount: number;
  };
  law: { riderIds: readonly string[]; mode: CopMode; copFrequency: number };
  traffic: MeasurementTrafficCapability;
  light: { requestedId: string | null; actualId: string };
  weather: { requested: RaceWeather; sky: RaceSky };
  contentIdentity: {
    eventPackIds: readonly string[];
    effectivePlayerBikeId: string;
    hashes: ContentHashes;
  };
  configProjection: DeepReadonly<ReplayConfig>;
  presentation: { graphicsPolicy: 'retain-current-graphics'; requiredFrameDivisor: 1 };
}
export type MeasurementSceneRefusal =
  | 'invalid-seed' | 'region-unavailable' | 'classic-unavailable'
  | 'standard-length-unavailable' | 'bike-unavailable' | 'light-unavailable'
  | 'route-unavailable' | 'route-incompatible' | 'content-not-ready'
  | 'empty-field' | 'law-unavailable' | 'traffic-unavailable' | 'resolved-scene-mismatch';
export type MeasurementFailedCheck =
  | 'seed' | 'region' | 'classic' | 'standard-length' | 'bike' | 'light'
  | 'route-entry' | 'route-membership' | 'content-dependencies' | 'field'
  | 'law' | 'traffic' | 'resolved-event' | 'resolved-region' | 'resolved-route'
  | 'resolved-bike' | 'resolved-field';
export type MeasurementMissingContentKind = 'pack' | 'event' | 'region' | 'route' | 'network' | 'road' | 'rider' | 'bike';
export interface MeasurementSceneRefusalEvidence {
  requested: MeasurementRequestSummary;
  failedCheck: MeasurementFailedCheck;
  expectedEventId: string | null;
  actualEventId: string | null;
  expectedEventKind: 'classic-race';
  actualEventKind: SimConfig['event']['kind'] | null;
  expectedRegionId: string;
  actualEventRegionId: string | null;
  expectedRouteId: string | null;
  actualRouteId: string | null;
  expectedNetworkId: string | null;
  actualNetworkId: string | null;
  actualNetworkRegionId: string | null;
  intendedBikeId: string | null;
  bikeSource: BikeSelectionSource | null;
  actualBikeId: string | null;
  actualTimeOfDay: string | null;
  field: {
    productLimit: 9;
    eligibleCount: number | null;
    maximumRivals: number | null;
    actualRivalIds: readonly string[] | null;
    actualRivalCount: number | null;
  };
  law: { riderIds: readonly string[]; mode: CopMode | null; copFrequency: number | null } | null;
  traffic: MeasurementTrafficCapability | null;
  missingContent: readonly { kind: MeasurementMissingContentKind; id: string }[];
}
export type MeasurementSceneResult =
  | { kind: 'ready'; config: SimConfig; stream: RegionStream;
      scene: DeepReadonly<MeasurementSceneDescription> }
  | { kind: 'refused'; reason: MeasurementSceneRefusal;
      evidence: DeepReadonly<MeasurementSceneRefusalEvidence> };
export declare function resolveMeasurementScene(reg: ContentRegistry,
  selection: Readonly<MeasurementSceneSelection>): MeasurementSceneResult;
```

Implement in `src/app/measurement-scene.ts`, with focused unit tests. Reuse public content,
stream, replay projection and configuration helpers; no ordinary builder/selection-policy changes.
The caller supplies fully loaded content and an explicit ephemeral uint32 seed. The helper owns a
fresh stream/config; local memoization is allowed. Never mutate registry, selection, garage, normal
stream or tuning. Accept no full settings/profile/tuning record, arbitrary setup/config, loader,
seed generator, renderer or storage. Config/stream are owned runtime handles, not frozen JSON.

## Exact metadata semantics

All IDs from content are qualified, except light IDs and the standard length ID, which retain their
existing bare vocabularies. Input region/route/bike strings must already be qualified; do not guess
a different pack. `requested` copies the user's selection and garage current ID. Its seed is the
finite input number, or null for a nonfinite input. SeedIssue is not-finite for NaN/infinities,
not-uint32 for finite nonintegers or values outside 0 through 4294967295, otherwise null.
No seed is coerced. On ready, requested.seed equals scene.seed and seedIssue is null.

Description event/region/network IDs describe the actual chosen content. Actual route is
`config.event.routeId`; network is the selected route entry's qualified network. Standard length
is the required candidate length, even when an alternate route overrides its road. lengthM is the
public `config.route.length`, not a sum that omits connector roads. Intended bike is the validated
precedence result; actual bike is the sole player's built bike content ID. Field actual IDs/count
are built rival-role definitions in config order. Eligible count is the pre-cap compatible cast
count, even when empty authored field prevents its use; maximum is zero for empty authored field,
otherwise min(eligibleCount, 9). Law IDs are built cop-role definitions with law data, in config
order; repeats are retained, not deduplicated. Mode/frequency come from the built cops block and
difficulty. Full law parameters, riders, traffic types/weights, workload/tuning, assists, speed and
slowMo are retained in configProjection, not reconstructed through another schema.

Light.actualId is the builder's resolved light determined using the same fixed seed and selected
valid light via `raceTimeOfDay`; SimConfig currently does not store that light as its own field.
Weather.sky is the copied result of `raceSky(reg, eventId, actualLight, selectedWeather)`.
Presentation fields are requirements/policies, never observed renderer state.

Evidence is a total object: initialize expectedRegionId from selection.regionId, expectedEventKind
to classic-race, all nullable resolved/stage fields to null, field.productLimit to 9, and
missingContent to an empty array. Populate each field as soon as its stage computes it, before
testing that stage's refusal condition; never omit fields or overwrite expected with actual.
Null means not yet evaluated or not resolvable, not zero/empty. Zero maximum/count and empty built
arrays are real evaluated values. expectedEventId is the strict candidate ID as soon as selection
succeeds; it stays null for missing classic. expectedRouteId is the requested explicit route or
resolved candidate standard route. For a present target route, expectedNetworkId is its qualified
network reference as soon as dependency preflight reads it, even if that network entry is absent.
These expected IDs preserve attempted-dependency evidence on content-not-ready.

Immediately after build, before any resolved comparison, populate actualEventId and actualEventKind
from config.event.contentId/kind, actualRouteId from config.event.routeId (null if absent), and
actual bike/rival fields from built definitions. Derive actualEventRegionId from the registry event
named by actualEventId, qualifying its region by that actual event ID's pack; use null when that
entry cannot be resolved. Derive actualNetworkId from the registry route named by actualRouteId,
qualifying its network by that actual route ID's pack; use null when the route entry is absent or
actualRouteId is null. Derive actualNetworkRegionId from that actual network entry, qualifying its
region by that actual network ID's pack; use null when it cannot be resolved. Retain missing
actual referenced entries in missingContent as well. These are the built configuration's declared
content references, not inferred physical renderer/network state. Never derive an actual region or
network using expectedEventId/expectedRouteId as a fallback. Populate all resolvable actual values
before the first comparison so an early mismatch retains the later independently observable IDs.
Actual fields remain null on pre-build refusals. actualTimeOfDay follows resolved light.
Law/traffic are populated at their evaluation stages even when those checks refuse. In evaluated
law evidence, absent mode is null and nonfinite copFrequency is null; an empty riderIds array
means no built law definitions. Ready law has a present non-none mode and finite positive frequency.
MissingContent lists absent checked entries in lexicographic kind then ID order, without duplicate
pairs; it is empty for failures not caused by absent entries.

Each ordinary reason uses its matching failedCheck: invalid-seed→seed, region-unavailable→region,
classic-unavailable→classic, standard-length-unavailable→standard-length, bike-unavailable→bike,
light-unavailable→light, route-unavailable→route-entry, route-incompatible→route-membership,
content-not-ready→content-dependencies, empty-field→field, law-unavailable→law,
traffic-unavailable→traffic. Resolved-scene-mismatch uses the first failed resolved-event,
resolved-region, resolved-route, resolved-bike or resolved-field check, in that order. Resolved-event
compares actualEventId/kind with expectedEventId/kind. Resolved-region compares BOTH
actualEventRegionId and actualNetworkRegionId with expectedRegionId; null/unresolvable actual region
cannot pass. Resolved-route compares actualRouteId and actualNetworkId with expectedRouteId and
expectedNetworkId, plus the existing road/route-handle invariants. Unexpected
programmer/builder errors remain errors, not generic content refusals. Missing loaded data is
not a claim that the selection can never be supported.

## Selection, dependencies and defaults

Order: seed, region, selector dependencies, strict candidate, standard length, bike, light, route/dependencies,
field, fresh stream/build, resolved invariant checks, law, traffic, identity/ready metadata.
Validate selected region presence before calling the candidate selector.

### Selector dependency preflight

`[default]` Source inspection found that quickPlayEvents computes all four families before its
result can be searched for Race. Its Escape filter invokes copIds and therefore packClosure.
The current raceField path used by Hunt does not invoke packClosure.

Insert a narrow selector-dependency preflight after seed and selected-region validation, before
the exact quickPlayEvents(reg, selectedRegion).find(choice => choice.kind === 'race') call.
Inspect exactly the Escape events that the current selector may send to copIds: kind cop-escape,
qualified region equals the selected region, no finale, no required ride-branch objective, and
event.cops?.mode !== 'none' (including absent cops). For each such event, traverse its owning pack
manifest and transitive dependency manifest references using a local visited set. Record every
absent manifest as a missingContent pair of kind pack; missing pairs are sorted and unique.

If any required selector manifest is missing, refuse content-not-ready/content-dependencies before
calling the selector. expectedRegionId/requested/expectedEventKind retain initialized values;
expectedEventId, expected route/network, intended bike/source, field stage and every actual field
remain unevaluated null, with field.productLimit nine. Do not guess or independently choose a Race
candidate to fill those fields. This early refusal takes precedence over classic/bike/light/route
checks because those stages have not run. The later selected candidate's dependency preflight and
all other stage ordering remain unchanged. Do not preflight unrelated regions, finales, required
branch events or Escape events whose authored cops mode is none.

Continue to call the exact public selector for a complete registry. No catch-all, ContentError
message parsing, selector family filtering, fallback candidate, selector change or fabricated
empty result. Unexpected selector/programmer failures propagate. Cyclic or otherwise invalid
loaded registries are not converted to a missing-content refusal by the visited traversal.

Acceptance: selected eligible Escape with absent own manifest or a transitive manifest refuses
with all initialized/stage-null fields and exact missing pack pairs. Complete-manifest positive
control reaches the same strict candidate. Missing manifests only on excluded Escape events or
other regions do not cause this early refusal. A thrown programmer error from an otherwise
complete selector remains an error. Preserve existing candidate-closure/dependency controls and
the exact public-selector invocation. This amendment changes no normal Quick Play behavior.

### Candidate selection and scene defaults

Use exactly `quickPlayEvents(reg, selectedRegion).find(choice => choice.kind === 'race')`.
Check actual candidate kind/qualified region; the selector excludes finales and required
ride-branch events. Do not call fallback-capable quickPlayEvent, relabel another family or search
later candidates to evade refusal. Require authored standard length; no first-length fallback.

Bike precedence is explicit menu bike, otherwise non-null garage current, otherwise player-preset
starter. Validate intended qualified bike exists and is permitted by menuBikes using garage
ownership. Invalid explicit/current bike refuses; both null choose a permitted starter. Grant no
secret ownership. Missing starter preset/dependency data is content-not-ready. Check actual player
bike including a permitted cross-pack choice. Explicit unavailable light refuses; null uses the
existing seeded draw. Keep weather separate under existing raceSky policy.

Null route means the candidate's own standard route. For explicit route: absent route entry →
route-unavailable; present route with absent referenced network or required road → content-not-ready;
complete route absent from `realRoutes(reg, eventId)` → route-incompatible; complete member → build.
Check dependencies BEFORE membership, since realRoutes otherwise hides missing-network cases.
For null route, an absent standard route/dependency is content-not-ready. Check the candidate's
authored length routes/networks required to determine its own networks, the event's pack closure,
the target network's complete roads list and target route's referenced roads (start/finish,
mainPath/allowedRoads/checkpoints/branches). Record missing entries before stream construction.
Do not treat a partial candidate network table as proof that an alternate is incompatible.
Recheck exact built event ID/kind, qualified event+network region, route/network ID and road/route
handles, player bike and field. Populate the distinct expected/actual evidence fields before these
checks in the order specified above. A builder fallback cannot qualify; derive actual region from
the BUILT event and BUILT route's referenced network because config.event has no separate region field.

Build through public buildSimConfig with `freePlay: true, rivals: 9`: the product maximum is nine
rivals, independent of the menu's MAX_RACE_RIVALS seven. Reuse DEFAULT_SETTINGS/DEFAULT_RACE_OPTIONS
for standard length, default difficulty/speed/assists/slowMo, open field, usual traffic and authored
law enabled, plus validated bike/light. Supply no user tuning, career patch/level/grudges or matched
field scaling. Omitted tuning uses declared sim defaults; omitted difficulty overrides resolve
declared difficulty defaults. Default slowMo remains on. Required frame divisor 1 does not disable
takedown time scaling; those actual-draw intervals remain eligible under the frame contract.

## Field and law qualification

Compute eligible rival IDs from the event's exact pack closure: role rival and no region or a
qualified region matching the candidate. Use the existing seeded raceField ordering. A nonempty
authored field plus an explicit count nine fields min(eligibleCount, 9); an empty authored field
returns empty before cast drawing and refuses with maximum zero. An empty compatible cast also
refuses zero. A short nonzero cast qualifies at its actual maximum. Verify built rival IDs/order/
count equal that maximum and contain no unrelated backfill. Do not import MAX_RACE_RIVALS or
pretend every current region contains nine rivals.

Require built authored law mode other than none, nonempty actual cop-role definitions carrying law
data, and finite positive resolved copFrequency. Enabling cops alone is insufficient. Law IDs keep
duplicate authored field slots. This is configured capability, never sustained runtime pressure.

## Exact traffic capability predicate

This is initialization/type capability only. It does not prove area occurrence on the selected
road, actual spawning, visible vehicles, lane clearance, density throughout a run or continuity.

Read master/same/oncoming/oddities from the built tuning IDs traffic.density, traffic.densitySame,
traffic.densityOncoming and traffic.oddities, with the sim's absent-value fallback 1. Read
traffic.oncomingEaseInS with absent fallback 0. Declared defaults today are respectively
1, 1, 1, 1 and 0. The resolver supplies no user tuning. Numeric metadata inputs are the finite
resolved values or null for nonfinite values; do not turn an invalid value into a valid default.
For each density component, a finite resolved number is clamped to [0,10], otherwise null.
Require master finite and positive and at least one finite positive direction slider/product.
effectiveDensity.same is clamped master × clamped same; oncomingTarget is clamped master ×
clamped oncoming. A direction is enabled only when that product is finite and positive.
enabledDirections is ordered same then oncoming. An invalid disabled direction need not prevent a
valid opposite direction from qualifying.

Source oncoming ease: if easeInS > 0, factor at elapsed world seconds t is
0.25 + 0.75 × clamp(t/easeInS, 0, 1); otherwise factor is 1. Metadata oncomingEase.enabled uses that
same >0 predicate, startFactor is 0.25 when enabled and 1 otherwise, finalFactor is 1.
oncomingAtStart is oncomingTarget × startFactor, or null if its density cannot be evaluated.
The normal declared default 0 seconds means no ease-in. This is a disclosed sim policy and target
density, not an observed spawn rate or measurement clock; introduce no new scaling.

For each built traffic type, category support is exactly car/truck/rv/oddity. Category weight
fallbacks are car 5, truck 2, rv 1.5, oddity 0.5, unsupported 0. Compute global raw weight as
type.weight ?? categoryFallback; globalWeight is that value if finite positive, otherwise 0.
Copy every explicit areaWeights key, normalizing each value to itself if finite positive,
otherwise 0; absent map becomes an empty map. initializationCompatible is supported category
AND (globalWeight > 0 OR some normalized area weight > 0). Area-only types count even with global
weight zero. Pedestrian/animal do not count. The input registry already excludes vetoed/unloaded
entries; do not invent a new modifier-only tag/category rule.

rollingOddity means category oddity AND cruiseMps > 0. The sim's parked-oddity predicate is category
oddity AND !(cruiseMps > 0). For a compatible non-oddity, usableDirections equals enabledDirections.
For a compatible oddity, usableDirections is empty unless the oddity slider is finite positive;
a rolling oddity then includes only enabled oncoming, while a parked oddity may include any
enabled direction. Incompatible types have empty usableDirections. The traffic.types array
describes EVERY built type in config order, including excluded types; effective source weights and
area maps therefore remain inspectable. capable is true iff finite positive master, at least one
enabled direction and at least one type with a nonempty usableDirections. Oddity-only may qualify,
but only with its slider and a usable direction; rolling-oddity/same-only refuses.

This matches the sim's type initialization and directional weight capabilities. Actual picking
uses the area at a slot, may fall back to global mix when that area has no weight that direction,
and still needs an available lane, target count, spacing and allowed spawn location. Do not claim
a complete runtime spawnability proof from this predicate.

## Exact content and configuration identity

Use only public helpers and an explicit owned registry assembly. Let eventPackIds be
packClosure(reg, packOf(eventId)), in that public closure's load order. Let eventReg be
packSubset(reg, eventPackIds). Let actualPlayerBikeId be the checked built player's bike ID.
Construct effective as eventReg with a copied bikes table containing that single actual player
bike definition from reg. Retain eventReg.packs, index and ALL other tables exactly; do not add
the bike's pack manifest, dependency closure or other entries. If the bike was already included,
this copy changes no content. The default measurement has no rival/cop bike overrides.
Set contentIdentity.hashes = contentHashes(effective) and effectivePlayerBikeId to that actual ID.

These are full and sim hashes of that EXACT effective registry, not just used entries or a
cryptographic config digest. contentHashes ignores index; full includes all retained manifests
and every loaded entry field. Sim includes retained manifest IDs/defaults.tuning and each entry
except the top-level exclusions in content/schema/tables.ts; wholly presentation-only types are
excluded from sim. Key/type/qualified-ID order is sorted; array order remains significant.
Unrelated content in the retained event closure can change these hashes by design; unrelated
outside-closure content cannot, except the deliberately selected player bike definition.
The additional bike's own fields count under the normal bike exclusion/full rules; its foreign
pack defaults and unrelated content do not participate. This mirrors the builder's player-only
withBikes behavior without importing its private helper.

Set configProjection to the nonoptional config returned by public
replayHeader(config, 'measurement-scene').config, then deeply freeze that owned copy.
The header type declares config optional for older recordings; if this builder call unexpectedly
omits it, throw a programmer error rather than fabricate a projection or return ready.
The literal measurement-scene is a projection argument only, not a real build/replay key;
do not return that header or create a replay recording. The public helper structured-clones
every config field except road and route query handles. Thus the projection includes seed,
event, riders/bikes/controllers/law, weapons, trafficTypes/area weights, modifiers, grudges,
tuning, difficulty, assists, slowMo, playerSlots, slots, speedMultiplier and smashables,
including any future fields included by the public ReplayConfig contract. It is explicitly
NOT a hash. Identity is the described content hashes plus qualified route/network and this
structured config projection. No normal seed, recorder or storage is touched.

## Automated acceptance

1. Qualifying loaded regional cases have a nonzero inspected-case control and inspect actual
   classic event/route/bike/default workload/law/traffic. Derive expected maximum independently
   from closure/region/role rules, nonempty authored field and PRODUCT limit nine, not menu cap,
   copied region counts or helper output. Include copied pools above seven and above nine:
   eight eligible rivals must field eight; ten or more must field nine. Short pools qualify;
   empty authored/eligible pools refuse with evaluated zero. Unrelated packs cannot inflate cast.
2. Remove classic but retain another family: classic-unavailable with ordinary fallback selector
   as positive control. Finale/required-branch-only and no-standard cases refuse. Assert exact
   reason, failedCheck, all evidence keys and stage/null semantics, not a loose optional bag.
   Scoped tests import resolveMeasurementScene and named metadata/result/refusal types from the
   APP-internal measurement-scene module. No app index barrel or other-module direct consumer is added.
3. Compatible GIS and different-network hand-made alternates retain exact ID. Missing route is
   route-unavailable; present route missing network/required roads is content-not-ready BEFORE
   membership; complete cross-region/same-network unsupported alternate is route-incompatible.
   Null route uses standard; missing its route/dependencies is content-not-ready. No fetch.
   Assert expectedRouteId/expectedNetworkId preserve attempted missing dependencies while actual
   event/route/network/region fields stay null before build. For substituted built-config mismatch
   controls, independently change actual event ID/kind, referenced event region, actual route's
   network reference and referenced network region. Require exact expected/actual event IDs/kinds,
   expectedRegionId, actualEventRegionId, expected/actual route/network IDs and actualNetworkRegionId
   in total evidence, populated before comparison. Positive controls show both region sources can
   resolve. Expected candidate/dependency values must survive mismatches rather than be overwritten;
   unresolvable actual references stay null and identify absent entries in missingContent.
4. Positive law control inspects actual cop definitions/mode/frequency; missing/no-law refuses.
   Validate refusal evidence, including duplicate law IDs where field slots cycle the same rider.
5. Traffic controls: global-only, area-only and supported oddity-only can qualify; pedestrian/
   animal-only, positive density with no compatible weighted type and all directions off refuse.
   Rolling-oddity/same-only refuses, rolling-oddity/oncoming and parked-oddity/enabled-direction
   qualify with positive oddity slider. Only-oddity with zero/nonfinite slider refuses.
   Nonfinite/nonpositive master refuses; one valid enabled direction may qualify if the other is
   off/invalid. Preserve finite-positive weight rules and density clamps/default/ease metadata.
   For direction/slider controls that the default-only resolver API cannot accept, exercise the
   pure traffic analysis through a substituted built-config result at the existing builder
   boundary; do not add arbitrary tuning/config inputs to resolveMeasurementScene or expose a
   normal app runtime override solely for tests. Positive controls prove each negative can detect
   a capable type/direction. All assertions remain configured capability, not live presence.
6. Menu/garage/starter and permitted cross-pack/owned-secret bikes retain exact actual ID; absent
   or disallowed intended bikes refuse. No ownership mutation or matched scaling. Changing the
   selected cross-pack bike's handling.accelMps2 changes effective sim/full hashes and its built
   player-bike projection; a presentation-only bike change changes full while respecting sim exclusions.
   Changing unrelated content/manifest in that foreign pack must not change effective hashes or
   projection. Verify retained event manifests/index and only-bike table augmentation explicitly.
7. Same content/selection/seed yields equivalent hashes/projection/cast/light. Config projection
   equals public replayHeader(config,'measurement-scene').config, omits only road/route and owns
   its nested data. Its generation is not a recording. Frozen inputs remain unchanged; description/
   evidence arrays/objects are fresh and deeply immutable. Invalid seed reports finite raw number
   or null plus exact SeedIssue, without coercion. No normal seeds/storage/UI/render/fetch/createSim.
8. Explicit light retained, Any seeded, unavailable explicit light refuses. Weather/raceSky stay
   presentation metadata; default slowMo true and full-rate requirement remain distinct. Actual
   renderer/device/refresh, planner readiness, live initialization/grid placement, runtime traffic/
   law continuity, duration and thermal equivalence remain outside this slice.

Ownership: one APP owner adds the APP-internal exported helper/types, tests and change note.
No cross-module barrel/export until a separate consumer contract; no app index/session, save/replay format,
sim balancing, platform/frame/collector, authored pack, CI or budget changes. Later APP integration
owns loading, guarded continuations, protected state, ephemeral seed, wake/frame/collector,
duration/repeats, cleanup and rendered controls. No GC or launch-performance verdict is introduced.
