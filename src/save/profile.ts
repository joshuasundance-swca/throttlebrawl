// The career profile record (docs/architecture.md, "Save format"; W-Q contracts; interview,
// 2026-10-02: the career is a tiered network map per region: claim roads, find secrets and
// shortcuts, a finale per region). The second record beside the settings: cash, owned bikes and
// their paint, per-region map progress (tier, roads opened and claimed, shortcuts and secrets
// found, nodes won, the finale), the grudges rivals keep across races (cockpit answer,
// 2026-09-29), and the event history.
//
// Versioned like the settings, with the migration runner the doc describes: an ordered list of
// pure `vN -> vN+1` functions, a one-slot backup of the record before a migration, and a record
// newer than the build refused and kept. Every version ships a golden fixture in
// tests/fixtures/save/ that CI migrates to the current version. Fields this build does not know
// are carried through load and save untouched, as the settings do. DOM-free.
import { checkHeader, MAX_SEASON, wrapRecord, type VersionedRecord } from '../core';
import type { StorageLike } from './index';

export const PROFILE_FORMAT = 'profile';

/** One region's progress on its career map. Ids are the map's (nodes, secrets) and the region's roads. */
export interface RegionProgress {
  /** The tier reached on this region's map, 1 = the first. */
  tier: number;
  /** Map node ids won. */
  won: string[];
  /** Roads opened by wins (road ids), for the map and free play. */
  unlockedRoads: string[];
  /** Roads claimed (won on: the map shows them as yours). */
  claimedRoads: string[];
  /** Route branches found by riding them, `<route ref>#<branch id>` (RouteProgress.branches). */
  foundShortcuts: string[];
  /** The map's secrets found (secret ids: a hidden road, a pirate station, a stash). */
  secrets: string[];
  /** The region's finale (the boss) beaten. */
  finaleBeaten: boolean;
}

export const EVENT_OUTCOMES = ['won', 'placed', 'lost', 'busted', 'wrecked', 'quit'] as const;
export type EventOutcome = (typeof EVENT_OUTCOMES)[number];

/** One race the career played, newest last. */
export interface EventResult {
  /** The event, qualified (`base:keys-t1-sunburn-sprint`). */
  event: string;
  /** The map node it was played from, or null in free play. */
  node: string | null;
  region: string;
  /** Final place, 1 = first; 0 when the rider did not finish. */
  place: number;
  outcome: EventOutcome;
  /** Cash the race paid, net of fines (may be negative). */
  cash: number;
  takedowns: number;
  /** The build and the time it was played. */
  build: string;
  at: string;
  /**
   * The season it was played in (playtest 3), 2 to MAX_SEASON; absent means Season 1, so a Season
   * 1 result is written exactly as before.
   */
  season?: number;
}

/**
 * A finished career kept as a backup code when the player starts a new one (playtest 3, round 3:
 * "a 'New career' button that keeps the old save as a backup code"): the export code
 * (save/export-code.ts) of the profile as it was, without its own `careerBackups`, so backups
 * never nest. Importing the code restores that career.
 */
export interface CareerBackup {
  /** The export code, `EC1.` and at most MAX_BACKUP_CODE_CHARS characters. */
  code: string;
  /** When it was kept (ISO time), '' when unknown. */
  at: string;
  /** The season that career had reached. */
  season: number;
}

/**
 * What the world remembers (run W-T, the pitch deck's #14: "a world that keeps receipts"): a rival
 * you put into traffic, or a bust, and where. The career draws them back into the world as a
 * billboard or a sign near the spot in later races. Only recorded facts: every field is what the
 * race's events said happened.
 */
export const RECEIPT_KINDS = ['takedown', 'bust'] as const;
export type ReceiptKind = (typeof RECEIPT_KINDS)[number];

export interface Receipt {
  kind: ReceiptKind;
  /** The region (bare id, as `regions` keys it) and the event (qualified) it happened in. */
  region: string;
  event: string;
  /** The road it happened on (a road id of the region) and how far along it, whole metres. */
  road: string;
  s: number;
  /** A takedown's rival (qualified rider id), or null. */
  rival: string | null;
  /** The traffic type a takedown went into (qualified traffic id, `base:rv`), or null. */
  vehicle: string | null;
  /** The career's count of this kind so far, this one included (`INCIDENT SITE #3`). */
  n: number;
}

export const FAILURE_MODES = ['road-trip', 'classic', 'hardcore'] as const;
export type FailureMode = (typeof FAILURE_MODES)[number];

export interface Profile {
  /** Whole cash, never below 0 (Road Trip: a fine never takes cash below $0). */
  cash: number;
  /** Bikes owned (qualified bike ids), the one ridden, and each owned bike's paint id. */
  bikes: { owned: string[]; current: string | null; paint: Record<string, string> };
  /** Map progress by region id. */
  regions: Record<string, RegionProgress>;
  /** Grudge points each rival holds toward each rider, by content id (SimConfig.grudges). */
  grudges: Record<string, Record<string, number>>;
  /** Races played, oldest first, at most MAX_HISTORY (the oldest drop off). */
  history: EventResult[];
  /** The failure-state policy (product spec): Road Trip by default [decided]. */
  failureMode: FailureMode;
  /**
   * Paint ids bought in the garage (run W-R career; product spec, Bikes: "Paint colors are the only
   * customization"). Additive: a record without it owns none, and the version stays 1.
   */
  paintsOwned: string[];
  /**
   * Once-per-career flags (docs/milestones/M4.md, career-1: "once-per-career flags"): the onboarding
   * prompts already shown (`prompt:<id>`) and the teasers already played (`teaser:<region>`).
   * Additive, like `paintsOwned`.
   */
  oncePerCareer: string[];
  /**
   * The world's receipts, oldest first, at most MAX_RECEIPTS (the oldest drop off). Additive, like
   * `paintsOwned`: a record without it has none, and the version stays 1.
   */
  receipts: Receipt[];
  /**
   * The season (playtest 3, round 2: "Longer + seasons": "Season 2+ with a harder field and
   * remixed events, the garage carried over"), 1 to MAX_SEASON. Additive: a record without it is
   * in Season 1, and the version stays 1.
   */
  season: number;
  /**
   * The season's remix seed, a uint32 drawn when the season starts (0 in Season 1, which is never
   * remixed): the same profile always remixes the same way.
   */
  seasonSeed: number;
  /** Careers kept when the player started a new one, oldest first, at most MAX_CAREER_BACKUPS. */
  careerBackups: CareerBackup[];
}

export { MAX_SEASON };
export const MAX_HISTORY = 200;
/** Careers kept as backup codes (the oldest drops off). */
export const MAX_CAREER_BACKUPS = 3;
/** The longest backup code kept, characters (a long finished career's plain code is far shorter). */
export const MAX_BACKUP_CODE_CHARS = 200_000;
export const MAX_IDS = 500;
export const CASH_MAX = 1_000_000_000;
export const MAX_RECEIPTS = 24;

export const DEFAULT_PROFILE: Readonly<Profile> = {
  cash: 0,
  bikes: { owned: [], current: null, paint: {} },
  regions: {},
  grudges: {},
  history: [],
  failureMode: 'road-trip',
  paintsOwned: [],
  oncePerCareer: [],
  receipts: [],
  season: 1,
  seasonSeed: 0,
  careerBackups: [],
};

export function emptyRegion(): RegionProgress {
  return {
    tier: 1,
    won: [],
    unlockedRoads: [],
    claimedRoads: [],
    foundShortcuts: [],
    secrets: [],
    finaleBeaten: false,
  };
}

// ---- Sanitising ----------------------------------------------------------------------------

const obj = (v: unknown): Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
const ID = /^(?:[a-z0-9-]+:)?[a-z0-9]+(?:[-/#.][a-z0-9]+)*$/;
const id = (v: unknown): string | null => (typeof v === 'string' && v.length <= 128 && ID.test(v) ? v : null);
const int = (v: unknown, lo: number, hi: number, fallback: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.round(v))) : fallback;
const oneOf = <T extends string>(v: unknown, options: readonly T[], fallback: T): T =>
  typeof v === 'string' && (options as readonly string[]).includes(v) ? (v as T) : fallback;

/** A sorted, de-duplicated list of well-formed ids, capped. */
function ids(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  const out = new Set<string>();
  for (const x of v) {
    const ok = id(x);
    if (ok !== null) out.add(ok);
    if (out.size >= MAX_IDS) break;
  }
  return [...out].sort();
}

function region(v: unknown): RegionProgress {
  const r = obj(v);
  return {
    tier: int(r['tier'], 1, 99, 1),
    won: ids(r['won']),
    unlockedRoads: ids(r['unlockedRoads']),
    claimedRoads: ids(r['claimedRoads']),
    foundShortcuts: ids(r['foundShortcuts']),
    secrets: ids(r['secrets']),
    finaleBeaten: r['finaleBeaten'] === true,
  };
}

function result(v: unknown): EventResult | null {
  const r = obj(v);
  const event = id(r['event']);
  const regionId = id(r['region']);
  if (event === null || regionId === null) return null;
  const text = (x: unknown, max: number) => (typeof x === 'string' && x.length <= max ? x : '');
  return {
    event,
    node: id(r['node']),
    region: regionId,
    place: int(r['place'], 0, 99, 0),
    outcome: oneOf(r['outcome'], EVENT_OUTCOMES, 'lost'),
    cash: int(r['cash'], -CASH_MAX, CASH_MAX, 0),
    takedowns: int(r['takedowns'], 0, 999, 0),
    build: text(r['build'], 64),
    at: text(r['at'], 40),
    ...seasonField(r['season']),
  };
}

/** A result's season: written only for Season 2 on, so Season 1 results stay as they were. */
function seasonField(v: unknown): { season?: number } {
  const s = int(v, 1, MAX_SEASON, 1);
  return s > 1 ? { season: s } : {};
}

/** A season's remix seed: a uint32, else 0. */
function uint32(v: unknown): number {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 0xffffffff ? v : 0;
}

function careerBackup(v: unknown): CareerBackup | null {
  const r = obj(v);
  const code = r['code'];
  if (typeof code !== 'string' || !code.startsWith('EC1.') || code.length > MAX_BACKUP_CODE_CHARS)
    return null;
  const at = r['at'];
  return {
    code,
    at: typeof at === 'string' && at.length <= 40 ? at : '',
    season: int(r['season'], 1, MAX_SEASON, 1),
  };
}

function receipt(v: unknown): Receipt | null {
  const r = obj(v);
  const regionId = id(r['region']);
  const event = id(r['event']);
  const road = id(r['road']);
  const kind = RECEIPT_KINDS.find((k) => k === r['kind']);
  if (regionId === null || event === null || road === null || !kind) return null;
  return {
    kind,
    region: regionId,
    event,
    road,
    s: int(r['s'], 0, 1_000_000, 0),
    rival: id(r['rival']),
    vehicle: id(r['vehicle']),
    n: int(r['n'], 1, 9999, 1),
  };
}

function grudges(v: unknown): Record<string, Record<string, number>> {
  const out: Record<string, Record<string, number>> = {};
  let n = 0;
  for (const [rival, row] of Object.entries(obj(v)).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    if (id(rival) === null || n >= MAX_IDS) continue;
    const kept: Record<string, number> = {};
    for (const [rider, points] of Object.entries(obj(row)).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
      if (id(rider) === null || typeof points !== 'number' || !Number.isFinite(points)) continue;
      kept[rider] = Math.min(1000, Math.max(-1000, points));
    }
    if (Object.keys(kept).length > 0) {
      out[rival] = kept;
      n++;
    }
  }
  return out;
}

/** Keeps each well-formed field and defaults the rest, so a bad value never reaches the career. */
export function sanitiseProfile(data: unknown): Profile {
  const d = obj(data);
  const b = obj(d['bikes']);
  const owned = ids(b['owned']);
  const current = id(b['current']);
  const paint: Record<string, string> = {};
  for (const [bike, p] of Object.entries(obj(b['paint']))) {
    const paintId = id(p);
    if (owned.includes(bike) && paintId !== null) paint[bike] = paintId;
  }
  const regions: Record<string, RegionProgress> = {};
  for (const [rid, r] of Object.entries(obj(d['regions']))) if (id(rid) !== null) regions[rid] = region(r);
  const history = (Array.isArray(d['history']) ? d['history'] : [])
    .map(result)
    .filter((r): r is EventResult => r !== null)
    .slice(-MAX_HISTORY);
  return {
    cash: int(d['cash'], 0, CASH_MAX, 0),
    bikes: { owned, current: current !== null && owned.includes(current) ? current : null, paint },
    regions,
    grudges: grudges(d['grudges']),
    history,
    failureMode: oneOf(d['failureMode'], FAILURE_MODES, 'road-trip'),
    paintsOwned: ids(d['paintsOwned']),
    oncePerCareer: ids(d['oncePerCareer']),
    receipts: (Array.isArray(d['receipts']) ? d['receipts'] : [])
      .map(receipt)
      .filter((r): r is Receipt => r !== null)
      .slice(-MAX_RECEIPTS),
    season: int(d['season'], 1, MAX_SEASON, 1),
    seasonSeed: uint32(d['seasonSeed']),
    careerBackups: (Array.isArray(d['careerBackups']) ? d['careerBackups'] : [])
      .map(careerBackup)
      .filter((b): b is CareerBackup => b !== null)
      .slice(-MAX_CAREER_BACKUPS),
  };
}

/** Fields of a record's data this build does not know: carried through load and save untouched. */
function unknownFields(data: unknown): Record<string, unknown> {
  const known = new Set(Object.keys(DEFAULT_PROFILE));
  return Object.fromEntries(Object.entries(obj(data)).filter(([k]) => !known.has(k)));
}

// ---- Versions and migrations -----------------------------------------------------------------

/** A pure step from one version's data to the next. */
export type Migration = (data: unknown) => unknown;

/**
 * The migrations, in order: MIGRATIONS[i] takes version i + 1 to version i + 2. The current
 * version is one past the last. A rename or a change of meaning adds one here, bumps the version
 * and adds that version's golden fixture; an additive field with a default needs neither.
 */
export const MIGRATIONS: readonly Migration[] = [];
export const PROFILE_VERSION = MIGRATIONS.length + 1;

export type MigrationResult =
  | { kind: 'ok'; version: number; data: unknown; migrated: number }
  | { kind: 'newer'; version: number }
  | { kind: 'invalid'; reason: string };

/**
 * Takes a raw parsed record to the current version: checks its header, then applies each
 * migration from its version on. A record newer than the build is reported, never touched.
 */
export function migrateProfile(raw: unknown, migrations: readonly Migration[] = MIGRATIONS): MigrationResult {
  const current = migrations.length + 1;
  const header = checkHeader(raw, PROFILE_FORMAT, current);
  if (header.kind === 'invalid') return header;
  if (header.kind === 'newer') return header;
  let data = (raw as { data: unknown }).data;
  for (let v = header.version; v < current; v++) {
    const step = migrations[v - 1];
    if (!step) return { kind: 'invalid', reason: `no migration from version ${v}` };
    data = step(data);
  }
  return { kind: 'ok', version: current, data, migrated: current - header.version };
}

// ---- The store -------------------------------------------------------------------------------

export const PROFILE_NOTICE_UNAVAILABLE = 'Career progress will not be saved on this device.';
export const PROFILE_NOTICE_NEWER =
  'Career progress comes from a newer build; starting fresh here and keeping it untouched.';

export function profileKey(keyPrefix: string): string {
  return `${keyPrefix}:profile`;
}
/** The one-slot backup of the record as it was before its last migration. */
export function profileBackupKey(keyPrefix: string): string {
  return `${keyPrefix}:profile:backup`;
}

export interface ProfileStore {
  /** The saved profile, migrated and sanitised, or a fresh one. Never throws. */
  load(): Profile;
  /** True when the record reached device storage; false when it is kept in memory only. */
  save(profile: Profile): boolean;
  readonly notice: string | null;
  /** The last record read or written, for the debug file and the export code. */
  record(): VersionedRecord<'profile', Profile> | null;
}

export interface ProfileStoreOptions {
  keyPrefix: string;
  build: string;
  storage: StorageLike | null;
  now?: () => string;
  /** The migrations to apply (tests inject their own; the build's by default). */
  migrations?: readonly Migration[];
}

export function createProfileStore(opts: ProfileStoreOptions): ProfileStore {
  const key = profileKey(opts.keyPrefix);
  const now = opts.now ?? (() => new Date().toISOString());
  const migrations = opts.migrations ?? MIGRATIONS;
  const version = migrations.length + 1;
  let memory: string | null = null;
  let usable = opts.storage !== null;
  let refused = false;
  let notice: string | null = usable ? null : PROFILE_NOTICE_UNAVAILABLE;
  let last: VersionedRecord<'profile', Profile> | null = null;
  let extras: Record<string, unknown> = {};
  const warn = (text: string) => {
    notice ??= text;
  };
  const get = (k: string): string | null => {
    if (!usable || !opts.storage) return null;
    try {
      return opts.storage.getItem(k);
    } catch {
      usable = false;
      warn(PROFILE_NOTICE_UNAVAILABLE);
      return null;
    }
  };
  const set = (k: string, text: string): boolean => {
    if (!usable || !opts.storage) return false;
    try {
      opts.storage.setItem(k, text);
      return true;
    } catch {
      usable = false;
      warn(PROFILE_NOTICE_UNAVAILABLE);
      return false;
    }
  };

  return {
    get notice() {
      return notice;
    },
    load() {
      const text = memory ?? get(key);
      if (!text) return sanitiseProfile({});
      let raw: unknown;
      try {
        raw = JSON.parse(text);
      } catch {
        return sanitiseProfile({});
      }
      const m = migrateProfile(raw, migrations);
      if (m.kind === 'newer') {
        refused = true;
        warn(PROFILE_NOTICE_NEWER);
        return sanitiseProfile({});
      }
      if (m.kind !== 'ok') return sanitiseProfile({});
      // Before the first save of a migrated record, keep the old one in the backup slot.
      if (m.migrated > 0 && memory === null) set(profileBackupKey(opts.keyPrefix), text);
      const profile = sanitiseProfile(m.data);
      extras = unknownFields(m.data);
      const rec = raw as VersionedRecord<'profile', unknown>;
      last = { ...rec, format: PROFILE_FORMAT, version, data: profile };
      return profile;
    },
    save(profile: Profile) {
      const clean = sanitiseProfile(profile);
      last = wrapRecord(PROFILE_FORMAT, version, opts.build, clean, now());
      const text = JSON.stringify({ ...last, data: { ...extras, ...clean } });
      if (refused || !set(key, text)) {
        memory = text;
        return false;
      }
      return true;
    },
    record: () => last,
  };
}
