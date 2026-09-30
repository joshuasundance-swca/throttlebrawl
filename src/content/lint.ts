// The pack lint (docs/content-packs.md, "Validation", step 2): the checks a single file cannot
// make. M1 rules: references, ids, public safety, the weapon steal window (in ticks) and tuning
// keys. Other lanes' rules (the road lane's first) plug in as PackRule hooks, so a new rule never
// edits this file. Runs over already-parsed packs; see parse.ts for the per-file checks.
import { secondsToTicks, type TuningParamDecl } from '../core';
import { error, pointer, warning, type Finding } from './findings';
import type { EntryStatus, ParsedEntry, ParsedPack } from './parse';
import { VETOABLE_ITEMS, type EntryType } from './schema';

type Json = Record<string, unknown>;
type Path = (string | number)[];

/** What a hooked rule sees: the parsed packs and a resolver that follows the reference rules. */
export interface LintContext {
  readonly packs: readonly ParsedPack[];
  /** Every entry of a type across the packs, vetoed ones left out (they are the taste log). */
  entries(type: EntryType): readonly ParsedEntry[];
  /** Resolves a bare or qualified reference from a pack, or says why it cannot. */
  resolve(fromPackId: string, ref: string, type: EntryType): { entry?: ParsedEntry; problem?: string };
}

/** A lint rule another lane contributes (the road lane's rules arrive this way). */
export interface PackRule {
  id: string;
  description: string;
  check(ctx: LintContext): Finding[];
}

export interface LintOptions {
  /** Every tuning declaration in the build; the tuning-key rule is skipped without it. */
  tuning?: readonly TuningParamDecl[];
  /** Extra rules, run after the built-in ones. */
  rules?: readonly PackRule[];
}

const isObj = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);

function at(value: unknown, path: Path): unknown {
  let cur = value;
  for (const p of path) {
    if (Array.isArray(cur) && typeof p === 'number') cur = cur[p];
    else if (isObj(cur) && typeof p === 'string') cur = cur[p];
    else return undefined;
  }
  return cur;
}

function arr(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function createContext(packs: readonly ParsedPack[]): LintContext {
  const byPack = new Map(packs.map((p) => [p.packId, p]));
  return {
    packs,
    entries: (type) =>
      packs.flatMap((p) => p.entries.filter((e) => e.type === type && e.status !== 'vetoed')),
    resolve(fromPackId, ref, type) {
      const i = ref.indexOf(':');
      const packId = i < 0 ? fromPackId : ref.slice(0, i);
      const id = i < 0 ? ref : ref.slice(i + 1);
      const from = byPack.get(fromPackId);
      // Bare ids never fall through to dependencies; qualified ones must name a declared dependency.
      if (packId !== fromPackId && !(packId in (from?.manifest.dependencies ?? {}))) {
        return { problem: `pack "${packId}" is not in this pack's dependencies` };
      }
      const pack = byPack.get(packId);
      if (!pack) return { problem: `pack "${packId}" is not loaded` };
      const entry = pack.entries.find((e) => e.type === type && e.id === id);
      return entry ? { entry } : { problem: `no ${type} "${ref}"` };
    },
  };
}

// ---------------------------------------------------------------------------------------------
// References

interface Ref {
  path: Path;
  ref: string;
  type: EntryType;
  /** An extra condition on the target, returning a problem or null. */
  require?: (target: ParsedEntry) => string | null;
  /**
   * Bark speakers and targets only warn: a line whose rider is missing never plays, which cannot
   * break a race, and bark sets may land before their rider files.
   */
  soft?: boolean;
}

const VEHICLES = ['car', 'truck', 'rv', 'oddity'];

function category(allowed: readonly string[], list: string) {
  return (t: ParsedEntry) =>
    allowed.includes(String(t.data['category']))
      ? null
      : `traffic type "${t.id}" has category ${String(t.data['category'])}, which does not belong in ${list}`;
}

/** Every reference field an entry holds, with the type it must point at. */
function referencesOf(e: ParsedEntry): Ref[] {
  const d = e.data;
  const refs: Ref[] = [];
  const one = (path: Path, type: EntryType, require?: Ref['require']) => {
    const v = at(d, path);
    if (typeof v === 'string') refs.push({ path, ref: v, type, ...(require ? { require } : {}) });
  };
  const each = (path: Path, type: EntryType, key?: string, require?: Ref['require']) => {
    arr(at(d, path)).forEach((_, i) => one(key ? [...path, i, key] : [...path, i], type, require));
  };
  // A bark speaker or target: a rider id, or a selector (any, player, role:, tag:, crew:<id>).
  const person = (path: Path) => {
    const v = at(d, path);
    if (typeof v !== 'string' || v === 'any' || v === 'player' || /^(?:role|tag):/.test(v)) return;
    if (v.startsWith('crew:')) refs.push({ path, ref: v.slice(5), type: 'crew', soft: true });
    else refs.push({ path, ref: v, type: 'rider', soft: true });
  };

  switch (e.type) {
    case 'rider':
      one(['bike'], 'bike');
      one(['startingWeapon'], 'weapon');
      one(['crew'], 'crew');
      one(['region'], 'region');
      one(['law', 'agency'], 'crew', (t) =>
        t.data['kind'] === 'law' ? null : `agency "${t.id}" must be a crew of kind "law"`,
      );
      break;
    case 'crew':
      one(['region'], 'region');
      each(['rivalCrews'], 'crew');
      break;
    case 'event':
      one(['region'], 'region');
      each(['lengths'], 'route', 'route');
      each(['field', 'riders'], 'rider');
      if (Array.isArray(at(d, ['modifiers', 'pool']))) each(['modifiers', 'pool'], 'event-modifier');
      break;
    case 'region':
      each(['networks'], 'road-network');
      each(['traffic', 'mix'], 'traffic-type', 'kind', category(VEHICLES, 'traffic.mix'));
      each(
        ['traffic', 'pedestrians'],
        'traffic-type',
        'kind',
        category(['pedestrian'], 'traffic.pedestrians'),
      );
      each(['traffic', 'animals'], 'traffic-type', 'kind', category(['animal'], 'traffic.animals'));
      break;
    case 'road-network':
      one(['region'], 'region');
      each(['roads'], 'road');
      arr(d['junctions']).forEach((_, j) => {
        each(['junctions', j, 'ends'], 'road', 'road');
        each(['junctions', j, 'connectors'], 'road', 'road');
      });
      break;
    case 'road':
      one(['network'], 'road-network');
      break;
    case 'route':
      one(['network'], 'road-network');
      one(['start', 'road'], 'road');
      one(['finish', 'road'], 'road');
      each(['mainPath'], 'road');
      each(['allowedRoads'], 'road');
      each(['checkpoints'], 'road', 'road');
      break;
    case 'bark-set':
      person(['defaults', 'speaker']);
      arr(d['lines']).forEach((_, i) => {
        person(['lines', i, 'speaker']);
        person(['lines', i, 'target']);
      });
      break;
    case 'tuning-preset':
      if (d['base'] !== 'registry') one(['base'], 'tuning-preset');
      break;
    case 'event-modifier':
      each(['eligibility', 'regions'], 'region');
      break;
    case 'station':
      each(['regions'], 'region');
      one(['djBarkSet'], 'bark-set');
      break;
    default:
      break;
  }
  return refs;
}

interface Problem {
  message: string;
  /** Warn instead of fail. */
  soft: boolean;
}

/**
 * Pointing at a vetoed entry or item fails (docs: nothing live references a vetoed one). A live
 * entry pointing at a draft only warns: release builds leave drafts out, so the reference is empty
 * there, which is how a lane keeps unfinished content (traffic-1's vehicle types) out of prod.
 */
function statusProblem(
  source: EntryStatus,
  target: ParsedEntry | { status: EntryStatus },
  what: string,
): Problem | null {
  if (target.status === 'vetoed') return { message: `points at the vetoed ${what}`, soft: false };
  if (target.status === 'draft' && source === 'live') {
    return {
      message: `points at the draft ${what}; release builds leave drafts out, so there it resolves to nothing`,
      soft: true,
    };
  }
  return null;
}

function push(out: Finding[], file: string, ptr: string, p: Problem): void {
  out.push(p.soft ? warning('refs', file, ptr, p.message) : error('refs', file, ptr, p.message));
}

/** The region a road sits in, through its network. */
function regionOfRoad(ctx: LintContext, road: ParsedEntry): ParsedEntry | undefined {
  const net = ctx.resolve(road.packId, String(road.data['network']), 'road-network').entry;
  const region = net ? ctx.resolve(net.packId, String(net.data['region']), 'region').entry : undefined;
  return region;
}

function checkRefs(ctx: LintContext): Finding[] {
  const out: Finding[] = [];
  for (const pack of ctx.packs) {
    for (const e of pack.entries) {
      if (e.status === 'vetoed') continue;
      for (const r of referencesOf(e)) {
        const ptr = pointer(r.path);
        const { entry, problem } = ctx.resolve(pack.packId, r.ref, r.type);
        const required = entry ? r.require?.(entry) : undefined;
        let bad: Problem | null = !entry
          ? { message: problem ?? `no ${r.type} "${r.ref}"`, soft: false }
          : (statusProblem(e.status, entry, `${r.type} "${r.ref}"`) ??
            (required ? { message: required, soft: false } : null));
        if (!bad) continue;
        if (r.soft) bad = { message: `${bad.message}; these lines stay silent until it loads`, soft: true };
        push(out, e.path, ptr, bad);
      }
      // A billboard slot on a road names an item in its region's signs or billboards.
      if (e.type === 'road') {
        arr(e.data['features']).forEach((f, i) => {
          if (!isObj(f) || f['kind'] !== 'billboard' || typeof f['item'] !== 'string') return;
          const region = regionOfRoad(ctx, e);
          if (!region) return; // the network reference is reported above
          const items = [...arr(region.data['signs']), ...arr(region.data['billboards'])].filter(isObj);
          const item = items.find((it) => it['id'] === f['item']);
          const ptr = pointer(['features', i, 'item']);
          if (!item) {
            out.push(
              error('refs', e.path, ptr, `no sign or billboard "${f['item']}" in region ${region.id}`),
            );
            return;
          }
          const status = (item['status'] as EntryStatus | undefined) ?? 'live';
          const bad = statusProblem(e.status, { status }, `item ${region.id}#${String(f['item'])}`);
          if (bad) push(out, e.path, ptr, bad);
        });
      }
    }
    // The pack's shipped defaults (only base's are read, but every pack's must resolve). A draft
    // default fails too: release builds would ship without it.
    const defaults = pack.manifest.defaults;
    const check = (ref: string, type: EntryType, ptr: string) => {
      const { entry, problem } = ctx.resolve(pack.packId, ref, type);
      const bad = entry
        ? statusProblem('live', entry, `${type} "${ref}"`)?.message
        : (problem ?? `no ${type} "${ref}"`);
      if (bad) out.push(error('refs', 'pack.json', ptr, bad));
    };
    if (defaults.tuning !== 'registry') check(defaults.tuning, 'tuning-preset', '/defaults/tuning');
    check(defaults.hud, 'hud-layout', '/defaults/hud');
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Ids: aliases and vetoable item ids (filename, folder and per-type uniqueness are in parse.ts)

function checkIds(ctx: LintContext): Finding[] {
  const out: Finding[] = [];
  for (const pack of ctx.packs) {
    const aliases = pack.manifest.idAliases ?? {};
    const ids = new Set(pack.entries.map((e) => e.id));
    for (const [from, to] of Object.entries(aliases)) {
      const ptr = pointer(['idAliases', from]);
      if (ids.has(from)) {
        out.push(
          error('ids', 'pack.json', ptr, `retired id "${from}" is still in use; never reuse a retired id`),
        );
      }
      if (to in aliases) out.push(error('ids', 'pack.json', ptr, `alias chain: "${to}" is itself an alias`));
      else if (!ids.has(to))
        out.push(error('ids', 'pack.json', ptr, `alias target "${to}" is not an id in this pack`));
    }
    for (const e of pack.entries) {
      const seen = new Set<string>();
      for (const list of VETOABLE_ITEMS[e.type] ?? []) {
        arr(e.data[list]).forEach((item, i) => {
          const id = isObj(item) ? item['id'] : undefined;
          if (typeof id !== 'string') return;
          if (seen.has(id)) {
            out.push(
              error(
                'ids',
                e.path,
                pointer([list, i, 'id']),
                `item id "${id}" is already used in this entry; content references must be unique`,
              ),
            );
          }
          seen.add(id);
        });
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Public safety: the banned name in display text and ids; authors are roles, not people

const BANNED_NAME = /road[\s_.-]*rash/i;
const DISPLAY_KEYS = new Set(['id', 'name', 'displayName', 'title', 'text', 'blurb', 'description']);
const ROLE_AUTHOR = /^(?:maintainer|agent|tools\/[a-z0-9._/-]+)$/;
const PACK_AUTHOR = /^(?:the maintainer|maintainer|agents?(?:\s.*)?|tools\/[a-z0-9._/-]+)$/;

function walk(value: unknown, path: Path, visit: (key: string, v: unknown, path: Path) => void): void {
  if (Array.isArray(value)) value.forEach((v, i) => walk(v, [...path, i], visit));
  else if (isObj(value)) {
    for (const [k, v] of Object.entries(value)) {
      visit(k, v, [...path, k]);
      walk(v, [...path, k], visit);
    }
  }
}

function safetyOf(file: string, data: unknown): Finding[] {
  const out: Finding[] = [];
  walk(data, [], (key, v, path) => {
    if (DISPLAY_KEYS.has(key) && typeof v === 'string' && BANNED_NAME.test(v)) {
      out.push(
        error(
          'public-safety',
          file,
          pointer(path),
          'names and player-facing text must not use the name of the game this one is inspired by',
        ),
      );
    }
    if (
      key === 'provenance' &&
      isObj(v) &&
      typeof v['author'] === 'string' &&
      !ROLE_AUTHOR.test(v['author'])
    ) {
      out.push(
        error(
          'public-safety',
          file,
          pointer([...path, 'author']),
          `author "${v['author']}" must be a role (maintainer, agent) or a tool path (tools/...), never a personal name or handle`,
        ),
      );
    }
  });
  return out;
}

function checkSafety(ctx: LintContext): Finding[] {
  const out: Finding[] = [];
  for (const pack of ctx.packs) {
    out.push(...safetyOf('pack.json', pack.manifest));
    (pack.manifest.authors ?? []).forEach((a, i) => {
      if (!PACK_AUTHOR.test(a)) {
        out.push(
          error(
            'public-safety',
            'pack.json',
            pointer(['authors', i]),
            `author "${a}" must be a role ("the maintainer", "agents ...") or a tool path, never a personal name or handle`,
          ),
        );
      }
    });
    for (const e of pack.entries) out.push(...safetyOf(e.path, e.data));
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Weapons: the steal window sits inside the wind-up, on tick values

/** Steal-window bounds in ticks, as buildSimConfig converts them (offsets, so 0 stays 0). */
export function stealTicks(startS: number, endS: number, windupS: number) {
  return { start: Math.round(startS * 60), end: Math.round(endS * 60), windup: secondsToTicks(windupS) };
}

function checkSteal(ctx: LintContext): Finding[] {
  const out: Finding[] = [];
  for (const e of ctx.entries('weapon')) {
    const steal = e.data['steal'];
    if (!isObj(steal) || steal['allowed'] !== true) continue;
    if (e.data['unarmed'] === true) {
      out.push(
        error('steal-window', e.path, '/steal/allowed', 'unarmed attacks cannot be dropped or stolen'),
      );
      continue;
    }
    const t = stealTicks(
      Number(steal['windowStartS']),
      Number(steal['windowEndS']),
      Number(e.data['windupS']),
    );
    if (t.end > t.windup) {
      out.push(
        error(
          'steal-window',
          e.path,
          '/steal/windowEndS',
          `the steal window ends at tick ${t.end} of the wind-up, which is only ${t.windup} ticks long (need 0 <= start < end <= wind-up, in ticks)`,
        ),
      );
    } else if (!(t.start < t.end)) {
      out.push(
        error(
          'steal-window',
          e.path,
          '/steal/windowEndS',
          `the steal window is empty in ticks (start ${t.start}, end ${t.end}); widen it`,
        ),
      );
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Tuning presets: keys exist in the parameter registry, values in range

function checkTuning(ctx: LintContext, decls: readonly TuningParamDecl[]): Finding[] {
  const out: Finding[] = [];
  const byId = new Map(decls.map((d) => [d.id, d]));
  for (const e of ctx.entries('tuning-preset')) {
    const values = isObj(e.data['values']) ? e.data['values'] : {};
    for (const [key, value] of Object.entries(values)) {
      const ptr = pointer(['values', key]);
      const decl = byId.get(key);
      if (!decl) out.push(error('tuning-keys', e.path, ptr, 'unknown tuning key (no module declares it)'));
      else if (typeof value === 'number' && (value < decl.min || value > decl.max)) {
        out.push(error('tuning-keys', e.path, ptr, `${value} is outside ${decl.min}..${decl.max}`));
      }
    }
  }
  return out;
}

/** The built-in rules' ids and what they check, for the tool's summary. */
export const BUILT_IN_RULES: readonly { id: string; description: string }[] = [
  { id: 'schema', description: 'strict JSON, the Zod schema for each type, pack format version' },
  { id: 'ids', description: 'filename = id, folder matches type, unique ids, idAliases, item ids' },
  { id: 'refs', description: 'references resolve to live entries of the right type' },
  { id: 'public-safety', description: 'no banned name in display text, authors are roles' },
  { id: 'steal-window', description: 'the steal window sits inside the wind-up, in ticks' },
  { id: 'tuning-keys', description: 'tuning preset keys exist and values are in range' },
];

/** Runs the cross-file rules over parsed packs (all packs at once, so references can cross). */
export function lintPacks(packs: readonly ParsedPack[], options: LintOptions = {}): Finding[] {
  const ctx = createContext(packs);
  const out = [...checkIds(ctx), ...checkRefs(ctx), ...checkSafety(ctx), ...checkSteal(ctx)];
  if (options.tuning) out.push(...checkTuning(ctx, options.tuning));
  for (const rule of options.rules ?? []) {
    try {
      out.push(...rule.check(ctx));
    } catch (err) {
      out.push(error(rule.id, '', '', `rule threw: ${err instanceof Error ? err.message : String(err)}`));
    }
  }
  return out;
}
