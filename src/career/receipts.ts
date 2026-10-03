// A world that keeps receipts (run W-T, the pitch deck's #14: "a billboard near where you put a rival
// into an RV; an 'INCIDENT SITE #3' cone where you were busted"). After a career race the profile
// keeps what happened and where (`Profile.receipts`, from the race log's incidents); before the next
// career race in that region, the nearest roadside board to each spot is rewritten to say so: a
// billboard for a rival put into a vehicle, a sign for a bust. A bust also leaves an incident site
// at the very spot (run W-U: "an 'INCIDENT SITE #3' cone where you were busted"): traffic cones round
// a small placard with the receipt's headline, on any road of the race, slot or no slot
// (`incidentSites`). DOM-free and pure: app/ hands in the
// race road's board slots with their world positions, and hands the result to the renderer as an
// ordinary board catalog, so the boards need nothing new from render/.
//
// Only recorded facts fill a receipt (the tone guide rules out false memories): the rival's and the
// vehicle's names, the road's name and the count all come from the saved receipt. A template that
// names a fact the receipt does not hold is never used for it. The words are each career file's
// loose `show.receipts` (`takedown` and `bust` lists of `{id, text, status}`), vetoable like signs:
// a board's content reference is `<pack>:career/<career id>#<template id>`. [default]
import type { ContentRegistry } from '../content';
import { MAX_RECEIPTS, type Profile, type Receipt, type ReceiptKind } from '../save';
import { bare, type CareerDef, type EventPlan } from './defs';
import type { RaceIncident, RaceTally } from './race-log';
import { fill, hashOf } from './show';

/** At most this many receipts rewrite boards in one race (the newest first). [default] */
export const RECEIPTS_PER_RACE = 3;
/** A receipt takes the nearest board slot within this many metres of its spot, else none. [default] */
export const RECEIPT_NEAR_M = 600;

export interface ReceiptTemplate {
  id: string;
  text: string;
}

/** A board slot on the race's roads: its road, its index among that road's features, where it stands. */
export interface BoardSpot {
  road: string;
  index: number;
  x: number;
  z: number;
}

/** One board a receipt rewrites: the slot, and the item the renderer draws in it. */
export interface ReceiptBoard {
  road: string;
  index: number;
  ref: string;
  text: string;
  kind: 'billboard' | 'sign';
  receipt: Receipt;
}

type Json = Record<string, unknown>;
const obj = (v: unknown): Json =>
  typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Json) : {};
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

/** A career file's receipt templates by kind, live ones only. */
export function receiptTemplates(
  reg: ContentRegistry,
  def: CareerDef,
): Record<ReceiptKind, ReceiptTemplate[]> {
  const own = obj(obj(obj(reg.careers[def.key])['show'])['receipts']);
  const read = (kind: ReceiptKind) =>
    list(own[kind])
      .map(obj)
      .filter(
        (t) =>
          typeof t['id'] === 'string' &&
          typeof t['text'] === 'string' &&
          (t['status'] === undefined || t['status'] === 'live'),
      )
      .map((t) => ({ id: t['id'] as string, text: t['text'] as string }));
  return { takedown: read('takedown'), bust: read('bust') };
}

/** The content reference a receipt board carries, for the veto. */
export function receiptRef(def: CareerDef, templateId: string): string {
  return `${def.pack}:career/${bare(def.key)}#${templateId}`;
}

/**
 * The receipts a career race leaves (its incidents, numbered): a bust is numbered by the career's
 * busts so far (its history's busted races, this one included); a takedown by the takedown receipts
 * kept so far. The profile's list keeps the newest MAX_RECEIPTS.
 */
export function withReceipts(
  profile: Profile,
  plan: EventPlan,
  regionId: string,
  tally: RaceTally,
  bustsSoFar: number,
): Receipt[] {
  const kept = [...(profile.receipts ?? [])];
  let takedowns = kept.filter((r) => r.kind === 'takedown').length;
  const incidents: readonly RaceIncident[] = tally.incidents ?? [];
  for (const i of incidents) {
    const n = i.kind === 'bust' ? Math.max(1, bustsSoFar) : ++takedowns;
    kept.push({
      kind: i.kind,
      region: regionId,
      event: plan.key,
      road: i.road,
      s: Math.round(i.s),
      rival: i.rival,
      vehicle: i.vehicle,
      n,
    });
  }
  return kept.slice(-MAX_RECEIPTS);
}

/** A table entry's display name by bare or qualified id, or null. */
function nameIn(
  table: Readonly<Record<string, { name?: string | undefined } | undefined>>,
  id: string | null,
): string | null {
  if (!id) return null;
  const direct = table[id]?.name;
  if (direct) return direct;
  const tail = `:${bare(id)}`;
  for (const [key, v] of Object.entries(table)) if (key.endsWith(tail) && v?.name) return v.name;
  return null;
}

/** A receipt's facts as template values; a fact the receipt does not hold is absent. */
export function receiptFacts(reg: ContentRegistry, r: Receipt): Record<string, string | number> {
  const out: Record<string, string | number> = { n: r.n };
  const rival = nameIn(reg.riders, r.rival);
  const vehicle = nameIn(reg.trafficTypes, r.vehicle);
  const road = nameIn(reg.roads, r.road);
  if (rival) out['rival'] = rival;
  if (vehicle) out['vehicle'] = vehicle;
  if (road) out['road'] = road;
  return out;
}

/** The template's text filled from the receipt, or null when it names a fact the receipt lacks. */
export function fillReceipt(
  template: string,
  facts: Readonly<Record<string, string | number>>,
): string | null {
  const text = fill(template, facts);
  return /\{[a-zA-Z]+\}/.test(text) ? null : text;
}

/** The receipt's template, seeded by the receipt (never the clock), filled from its facts; or null. */
function pickReceipt(
  reg: ContentRegistry,
  def: CareerDef,
  templates: Record<ReceiptKind, ReceiptTemplate[]>,
  r: Receipt,
  vetoed: ReadonlySet<string>,
): { ref: string; text: string } | null {
  const facts = receiptFacts(reg, r);
  const fits = templates[r.kind]
    .filter((t) => !vetoed.has(receiptRef(def, t.id)))
    .map((t) => ({ t, text: fillReceipt(t.text, facts) }))
    .filter((x): x is { t: ReceiptTemplate; text: string } => x.text !== null);
  if (fits.length === 0) return null;
  const pick = fits[hashOf(`receipt:${r.event}:${r.kind}:${r.n}:${r.road}`) % fits.length];
  return pick ? { ref: receiptRef(def, pick.t.id), text: pick.text } : null;
}

/** An incident site: where a bust happened, and what its placard says (the receipt's headline). */
export interface IncidentSite {
  road: string;
  s: number;
  ref: string;
  /** The placard: the receipt's first sentence, "INCIDENT SITE #3." */
  text: string;
  receipt: Receipt;
}

/** A receipt's headline: its first sentence (render's boards split a board's copy the same way). */
export function headlineOf(text: string): string {
  const t = text.trim().replace(/\s+/g, ' ');
  const m = /^(.+?[.!?])(\s|$)/.exec(t);
  return m?.[1] ?? t;
}

/**
 * The incident sites a career race shows (run W-U): the region's newest bust receipts (at most
 * RECEIPTS_PER_RACE) whose spot is on this race's roads (`onRoad` says so), each at its own spot,
 * with the template its sign uses (so one cut removes both), headline only. A bust that fills no
 * template, or whose template this device cut, shows none.
 */
export function incidentSites(
  reg: ContentRegistry,
  def: CareerDef,
  receipts: readonly Receipt[],
  onRoad: (road: string) => boolean,
  vetoed: ReadonlySet<string> = new Set(),
): IncidentSite[] {
  const templates = receiptTemplates(reg, def);
  const out: IncidentSite[] = [];
  for (const r of [...receipts].reverse()) {
    if (out.length >= RECEIPTS_PER_RACE) break;
    if (r.kind !== 'bust' || r.region !== def.regionId || !onRoad(r.road)) continue;
    const pick = pickReceipt(reg, def, templates, r, vetoed);
    if (!pick) continue;
    out.push({ road: r.road, s: r.s, ref: pick.ref, text: headlineOf(pick.text), receipt: r });
  }
  return out;
}

/**
 * The boards a career race's receipts rewrite: the region's newest receipts (at most
 * RECEIPTS_PER_RACE) whose spot is on this race's roads (`at` places it, or says null), each on the
 * nearest free board slot within RECEIPT_NEAR_M, with a template seeded by the receipt (never the
 * clock) that its facts fill completely and that this device has not cut.
 */
export function receiptBoards(
  reg: ContentRegistry,
  def: CareerDef,
  receipts: readonly Receipt[],
  spots: readonly BoardSpot[],
  at: (road: string, s: number) => { x: number; z: number } | null,
  vetoed: ReadonlySet<string> = new Set(),
): ReceiptBoard[] {
  const templates = receiptTemplates(reg, def);
  const used = new Set<string>();
  const out: ReceiptBoard[] = [];
  for (const r of [...receipts].reverse()) {
    if (out.length >= RECEIPTS_PER_RACE) break;
    if (r.region !== def.regionId) continue;
    const p = at(r.road, r.s);
    if (!p) continue;
    let best: BoardSpot | null = null;
    let bestD = RECEIPT_NEAR_M;
    for (const spot of spots) {
      const d = Math.hypot(spot.x - p.x, spot.z - p.z);
      if (d <= bestD && !used.has(`${spot.road}#${spot.index}`)) {
        best = spot;
        bestD = d;
      }
    }
    if (!best) continue;
    const pick = pickReceipt(reg, def, templates, r, vetoed);
    if (!pick) continue;
    used.add(`${best.road}#${best.index}`);
    out.push({
      road: best.road,
      index: best.index,
      ref: pick.ref,
      text: pick.text,
      kind: r.kind === 'bust' ? 'sign' : 'billboard',
      receipt: r,
    });
  }
  return out;
}
