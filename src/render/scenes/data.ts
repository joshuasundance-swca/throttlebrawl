// Staged roadside scenes (run W-T, pitch 6 "the horizon comes alive": "small staged scenes beside
// the road, each with ONE dry sign"; "signs stay headline-short, because you pass them at speed").
// Each region pack carries its scenes as one data file, `assets/scenes/<region-id>.json`
// (docs/content-packs.md, "Roadside scenes"): an asset data file, like the backdrop's, so the
// registry, the replay key and both content hashes never see it. A scene is a few coloured boxes
// and one sign, in its own frame:
// - x runs along the road, y is up from the ground (or the waterline, for a scene on the water),
//   and +z points at the road; the sign faces +z;
// - the renderer stands the scene on the land (or water) its `on` themes name, past the ridable
//   ground band, and turns its +z toward a rider coming up the road.
// Every number here is [default].

/** A scene's box: size [w, h, d] m, centre [x, y, z] m, turns in radians, a #rrggbb colour. */
export interface ScenePart {
  box: readonly [number, number, number];
  at: readonly [number, number, number];
  rotX?: number;
  rotY?: number;
  rotZ?: number;
  colour: string;
  /** Kept in the far level of detail (the scene's outline); small parts drop out past it. */
  far?: boolean;
}

export interface SceneSign {
  /** All caps, headline-short: the first sentence is the headline, the rest a small kicker. */
  text: string;
  /** The sign's centre, m, in the scene's frame; it faces +z. */
  at: readonly [number, number, number];
  /** Width and height, m. */
  size: readonly [number, number];
  bg: string;
  fg: string;
  /** The post's colour (default a weathered brown); `posts: 0` hangs the sign on a part. */
  post?: string;
  posts?: 0 | 1 | 2;
}

export type SceneStatus = 'live' | 'draft' | 'vetoed';

export interface SceneDef {
  /** Unique within the region file: the veto names it (`<pack>:scenes/<region>#<id>`). */
  id: string;
  /** `live` scenes are placed; `draft` and `vetoed` ones stay in the file as the taste log. */
  status: SceneStatus;
  /** Why it was cut, or anything worth keeping beside it. */
  note?: string;
  /** The side themes it may stand on (render/scenery.ts `SideTheme`: `water`, `forest`, `urban`...). */
  on: readonly string[];
  /** How far past the verge (and the ridable band) its middle stands, m: [near, far]. */
  acrossM: readonly [number, number];
  /** Its footprint round the middle, m: nothing else stands inside it. */
  radiusM: number;
  sign: SceneSign;
  parts: readonly ScenePart[];
}

export interface ScenesFile {
  formatVersion: 1;
  region: string;
  /** One scene per this many metres of road at most (seeded spots, each scene once a race). */
  everyM: number;
  /**
   * At most this many scenes a race (default 5): a long road that could show them all shows a
   * seeded few, so each race's line-up differs.
   */
  maxPerRace?: number;
  scenes: readonly SceneDef[];
}

/** Scenes a race when the file does not say. */
export const SCENES_PER_RACE = 5;

/** Signs at speed: at most this many words and characters (the pitch: "headline-short"). */
export const SIGN_MAX_WORDS = 6;
export const SIGN_MAX_CHARS = 32;

const HEX = /^#[0-9a-f]{6}$/i;
const THEMES = new Set([
  'water',
  'palms',
  'beach',
  'mangrove',
  'commercial',
  'urban',
  'industrial',
  'sawmill',
  'forest',
  // run W-U: San Francisco's waterfront (the promenade on the bay side, the blocks on the city side)
  'promenade',
  'wharf',
]);

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isVec = (v: unknown, n: number) => Array.isArray(v) && v.length === n && v.every(isNum);

/** Checks one scenes file; returns the problems found (empty: fine). */
export function scenesProblems(json: unknown): string[] {
  const out: string[] = [];
  const o = json as Record<string, unknown> | null;
  if (!o || typeof o !== 'object') return ['not an object'];
  if (o['formatVersion'] !== 1) out.push('formatVersion must be 1');
  if (typeof o['region'] !== 'string') out.push('region must be a string');
  if (!(isNum(o['everyM']) && o['everyM'] >= 200)) out.push('everyM must be at least 200');
  const max = o['maxPerRace'];
  if (max !== undefined && !(Number.isInteger(max) && (max as number) >= 1))
    out.push('maxPerRace must be 1 or more');
  const scenes = o['scenes'];
  if (!Array.isArray(scenes)) return [...out, 'scenes must be an array'];
  const ids = new Set<string>();
  for (const [i, raw] of scenes.entries()) {
    const q = raw as Record<string, unknown>;
    const at = `scenes[${i}]`;
    const id = q['id'];
    if (typeof id !== 'string' || !/^[a-z0-9-]+$/.test(id)) out.push(`${at}: id must be kebab-case`);
    else if (ids.has(id)) out.push(`${at}: duplicate id ${id}`);
    else ids.add(id);
    if (!['live', 'draft', 'vetoed'].includes(q['status'] as string))
      out.push(`${at}: status live|draft|vetoed`);
    const on = q['on'];
    if (!Array.isArray(on) || !on.length || on.some((t) => !THEMES.has(t as string)))
      out.push(`${at}: on must list side themes`);
    else if (on.includes('water') && on.length > 1) out.push(`${at}: a water scene stands on water only`);
    const across = q['acrossM'];
    if (
      !isVec(across, 2) ||
      (across as number[])[0]! < 0 ||
      (across as number[])[1]! < (across as number[])[0]!
    )
      out.push(`${at}: acrossM must be [near, far] metres`);
    if (!(isNum(q['radiusM']) && q['radiusM'] > 0 && q['radiusM'] <= 12))
      out.push(`${at}: radiusM must be 0..12`);
    const sign = q['sign'] as Record<string, unknown> | undefined;
    if (!sign || typeof sign !== 'object') out.push(`${at}: sign missing`);
    else {
      const text = sign['text'];
      if (typeof text !== 'string' || !text.trim()) out.push(`${at}.sign: text missing`);
      else {
        if (text !== text.toUpperCase()) out.push(`${at}.sign: all caps`);
        if (text.length > SIGN_MAX_CHARS || text.trim().split(/\s+/).length > SIGN_MAX_WORDS)
          out.push(`${at}.sign: headline-short (${SIGN_MAX_WORDS} words, ${SIGN_MAX_CHARS} characters)`);
      }
      if (!isVec(sign['at'], 3)) out.push(`${at}.sign: at must be [x, y, z]`);
      if (!isVec(sign['size'], 2)) out.push(`${at}.sign: size must be [w, h]`);
      for (const k of ['bg', 'fg', 'post'])
        if (sign[k] !== undefined && (typeof sign[k] !== 'string' || !HEX.test(sign[k])))
          out.push(`${at}.sign.${k}: not #rrggbb`);
      if (sign['bg'] === undefined || sign['fg'] === undefined) out.push(`${at}.sign: bg and fg needed`);
      if (sign['posts'] !== undefined && ![0, 1, 2].includes(sign['posts'] as number))
        out.push(`${at}.sign: posts 0, 1 or 2`);
    }
    const parts = q['parts'];
    if (!Array.isArray(parts) || !parts.length) out.push(`${at}: parts missing`);
    else
      for (const [j, pr] of parts.entries()) {
        const p = pr as Record<string, unknown>;
        if (!isVec(p['box'], 3) || (p['box'] as number[]).some((n) => n <= 0))
          out.push(`${at}.parts[${j}]: box must be [w, h, d] > 0`);
        if (!isVec(p['at'], 3)) out.push(`${at}.parts[${j}]: at must be [x, y, z]`);
        if (typeof p['colour'] !== 'string' || !HEX.test(p['colour']))
          out.push(`${at}.parts[${j}]: colour not #rrggbb`);
        for (const k of ['rotX', 'rotY', 'rotZ'])
          if (p[k] !== undefined && !isNum(p[k])) out.push(`${at}.parts[${j}].${k}: a number`);
      }
  }
  return out;
}
