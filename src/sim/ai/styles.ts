// AI style presets (docs/architecture.md, "Controllers"; docs/content-packs.md, "Rider"). A style is
// a named preset: a behaviour set plus numbers. A rider's own `personality` numbers override the
// preset's, so a rival can be one line (`"style": "heavy-hitter"`) or fully bespoke.
//
// M1 registered two presets, `heavy-hitter` (a brawler who hunts a target) and `racer` (races, and
// only swings at whoever drifts into reach). M4 rivals-1 (built early, [default]) registers the
// rest of the tone guide's cast styles, each a behaviour set plus a few traits:
//   - heavy-hitter: hunts, hits hard, slow off the line (Deacon Vane);
//   - weaver: fast and erratic, swerves across the road, not just its lane (Dial-Up);
//   - showboat: fights only when it looks good: never the race leader (he sides with whoever is
//     winning), never someone healthier than him (Chad Speedwell);
//   - grudge-keeper: hunts, and keeps an exact tally: one hit from you and you are on the list for
//     the rest of the race, each further hit makes him swing more (Kevin from Accounting);
//   - scrapper: quick off the line, never backs down, and goes straight back at whoever just hit
//     her (Tammy Two-Stroke);
//   - crowd-pleaser: hunts, then flees when the fight turns: below a health fraction he stops
//     swinging and rides away from the pack (The Mayor);
//   - crew-boss: hunts from the front: rides a little above pace, deals with whoever is closing on
//     her from behind first, and waits for nobody (Mother Rust).
// `cop` riders are driven by sim/cops, never here; an unknown style id falls back to `racer`.
// Every trait is a [default] feel number; the `ai.styleQuirks` tuning switch turns all of them off
// at once (back to M1's behaviour sets with the style's numbers).
import type { SimAiPersonality } from '../types';

/** `brawler` seeks a target and rides alongside it; `racer` holds its line and swings opportunistically. */
export type AiBehaviour = 'brawler' | 'racer';

/** The quirks that make one style ride differently from another (rivals-1). Neutral values do nothing. */
export interface AiTraits {
  /** Personal pace multiplier on the event's pace. */
  paceBias: number;
  /**
   * Off the line, for LAUNCH_TICKS: below 1 caps the throttle (slow to accelerate), above 1 raises
   * the speed it aims for (quick off the line).
   */
  launch: number;
  /** Metres of lateral swing per unit of `weave` (M1: 1.4, inside its lane). */
  weaveSpanM: number;
  /** Ticks per weave cycle (M1: 240). */
  weavePeriodTicks: number;
  /** Chance per second of a sudden jump in the weave (0: a smooth sine). */
  erratic: number;
  /** Whether its weave may leave its own lane (still kept off the road's edges and out of traffic). */
  roadWeave: boolean;
  /** Never swings at the race leader, nor at anyone healthier than itself. */
  showboat: boolean;
  /** Hits taken from one rider before it holds a race-long grudge against them (0: never). */
  tally: number;
  /** Ticks it hunts whoever last hit it (0: never). */
  retaliateTicks: number;
  /** Fights whatever its health. */
  fearless: boolean;
  /** Health fraction below which it stops fighting and rides away from the pack (0: never). */
  fleeBelow: number;
  /** Fights riders closing on it from behind first, and waits for nobody. */
  defends: boolean;
}

export interface AiProfile {
  style: string;
  behaviour: AiBehaviour;
  /** How often it swings and how far it looks for a fight. */
  aggression: number;
  /** How often a swing is a kick. */
  dirtiness: number;
  /** How hurt it can be and still pick a fight. */
  courage: number;
  /** How readily it dodges traffic through the oncoming lane. */
  riskTaking: number;
  /** Reserved for barks (narrative reads rider files directly). */
  chatter: number;
  /** Lane habit: how far it drifts across its lane (0 holds a line). */
  weave: number;
  targetPreference: readonly string[];
  preferredSide: 'left' | 'right' | 'either';
  /** Authored rivalries: bare rider ids it picks a fight with whenever one is in range. */
  rivals: readonly string[];
  /** A weapon id it goes out of its way to pick up, or null. */
  preferredWeapon: string | null;
  traits: AiTraits;
}

type Preset = Omit<AiProfile, 'style' | 'rivals' | 'preferredWeapon'>;

/** M1's behaviour: no quirks. */
export const NEUTRAL_TRAITS: Readonly<AiTraits> = {
  paceBias: 1,
  launch: 1,
  weaveSpanM: 1.4,
  weavePeriodTicks: 240,
  erratic: 0,
  roadWeave: false,
  showboat: false,
  tally: 0,
  retaliateTicks: 0,
  fearless: false,
  fleeBelow: 0,
  defends: false,
};

const t = (over: Partial<AiTraits>): AiTraits => ({ ...NEUTRAL_TRAITS, ...over });

export const AI_STYLE_IDS = [
  'heavy-hitter',
  'weaver',
  'showboat',
  'grudge-keeper',
  'scrapper',
  'crowd-pleaser',
  'crew-boss',
  'racer',
] as const;
export type AiStyleId = (typeof AI_STYLE_IDS)[number];

export const AI_PRESETS: Readonly<Record<AiStyleId, Preset>> = {
  'heavy-hitter': {
    behaviour: 'brawler',
    aggression: 0.8,
    dirtiness: 0.5,
    courage: 0.8,
    riskTaking: 0.35,
    chatter: 0.6,
    weave: 0.1,
    targetPreference: ['player', 'nearest'],
    preferredSide: 'either',
    traits: t({ launch: 0.85 }),
  },
  weaver: {
    behaviour: 'racer',
    aggression: 0.45,
    dirtiness: 0.75,
    courage: 0.35,
    riskTaking: 0.9,
    chatter: 0.8,
    weave: 0.8,
    targetPreference: ['nearest', 'player'],
    preferredSide: 'either',
    traits: t({ paceBias: 1.03, weaveSpanM: 2.6, weavePeriodTicks: 150, erratic: 0.5, roadWeave: true }),
  },
  showboat: {
    behaviour: 'racer',
    aggression: 0.5,
    dirtiness: 0.25,
    courage: 0.5,
    riskTaking: 0.5,
    chatter: 0.9,
    weave: 0.2,
    targetPreference: ['player', 'nearest'],
    preferredSide: 'either',
    traits: t({ showboat: true }),
  },
  'grudge-keeper': {
    behaviour: 'brawler',
    aggression: 0.7,
    dirtiness: 0.8,
    courage: 0.75,
    riskTaking: 0.15,
    chatter: 0.6,
    weave: 0,
    targetPreference: ['grudge', 'player', 'nearest'],
    preferredSide: 'either',
    traits: t({ tally: 1 }),
  },
  scrapper: {
    behaviour: 'racer',
    aggression: 0.6,
    dirtiness: 0.6,
    courage: 1,
    riskTaking: 0.8,
    chatter: 0.7,
    weave: 0.3,
    targetPreference: ['nearest', 'player'],
    preferredSide: 'either',
    traits: t({ launch: 1.12, retaliateTicks: 300, fearless: true }),
  },
  'crowd-pleaser': {
    behaviour: 'brawler',
    aggression: 0.55,
    dirtiness: 0.3,
    courage: 0.3,
    riskTaking: 0.4,
    chatter: 0.8,
    weave: 0.15,
    targetPreference: ['player', 'nearest'],
    preferredSide: 'either',
    traits: t({ fleeBelow: 0.6 }),
  },
  'crew-boss': {
    behaviour: 'brawler',
    aggression: 0.75,
    dirtiness: 0.55,
    courage: 0.9,
    riskTaking: 0.45,
    chatter: 0.5,
    weave: 0.05,
    targetPreference: ['chaser', 'player', 'nearest'],
    preferredSide: 'either',
    traits: t({ paceBias: 1.02, defends: true }),
  },
  racer: {
    behaviour: 'racer',
    aggression: 0.35,
    dirtiness: 0.2,
    courage: 0.5,
    riskTaking: 0.6,
    chatter: 0.4,
    weave: 0.15,
    targetPreference: ['nearest'],
    preferredSide: 'either',
    traits: NEUTRAL_TRAITS,
  },
};

function isStyle(style: string): style is AiStyleId {
  return (AI_STYLE_IDS as readonly string[]).includes(style);
}

const NUMBERS = ['aggression', 'dirtiness', 'courage', 'riskTaking', 'chatter', 'weave'] as const;

function unit(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

/** A rider id without its pack prefix (`base:chad-speedwell` → `chad-speedwell`). */
export function bareId(contentId: string): string {
  const i = contentId.lastIndexOf(':');
  return i < 0 ? contentId : contentId.slice(i + 1);
}

/**
 * The preset for a style id, with the rider's own numbers laid over it (each clamped to 0..1).
 * With `quirks` false the style's traits are dropped (the `ai.styleQuirks` switch).
 */
export function resolveProfile(style: string, own: SimAiPersonality | undefined, quirks = true): AiProfile {
  const preset: Preset = isStyle(style) ? AI_PRESETS[style] : AI_PRESETS.racer;
  const profile: AiProfile = {
    ...preset,
    style,
    rivals: [],
    preferredWeapon: null,
    traits: quirks ? preset.traits : NEUTRAL_TRAITS,
  };
  if (!own) return profile;
  for (const key of NUMBERS) {
    const value = own[key];
    if (value !== undefined && Number.isFinite(value)) profile[key] = unit(value);
  }
  if (own.targetPreference && own.targetPreference.length > 0)
    profile.targetPreference = own.targetPreference;
  if (own.preferredSide) profile.preferredSide = own.preferredSide;
  if (own.rivals && own.rivals.length > 0) profile.rivals = own.rivals.map(bareId);
  if (own.preferredWeapon) profile.preferredWeapon = bareId(own.preferredWeapon);
  return profile;
}

/** Whether a style hunts a target by itself (a brawler), rather than only when it holds a grudge. */
export function huntsByDefault(style: string): boolean {
  return (isStyle(style) ? AI_PRESETS[style] : AI_PRESETS.racer).behaviour === 'brawler';
}
