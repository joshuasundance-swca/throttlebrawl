// AI style presets (docs/architecture.md, "Controllers"; docs/content-packs.md, "Rider"). A style is
// a named preset: a behaviour set plus numbers. A rider's own `personality` numbers override the
// preset's, so a rival can be one line (`"style": "heavy-hitter"`) or fully bespoke. M1 registers
// two presets [default]: `heavy-hitter` (a brawler who hunts a target) and `racer` (races, and only
// swings at whoever drifts into reach). Any other style id falls back to `racer` until its own
// preset lands.
import type { SimAiPersonality } from '../types';

/** `brawler` seeks a target and rides alongside it; `racer` holds its line and swings opportunistically. */
export type AiBehaviour = 'brawler' | 'racer';

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
  /** Reserved for barks (narrative-1 reads rider files directly). */
  chatter: number;
  /** Lane habit: how far it drifts across its lane (0 holds a line). */
  weave: number;
  targetPreference: readonly string[];
  preferredSide: 'left' | 'right' | 'either';
}

type Preset = Omit<AiProfile, 'style'>;

export const AI_PRESETS: Readonly<Record<'heavy-hitter' | 'racer', Preset>> = {
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
  },
};

const NUMBERS = ['aggression', 'dirtiness', 'courage', 'riskTaking', 'chatter', 'weave'] as const;

function unit(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

/** The preset for a style id, with the rider's own numbers laid over it (each clamped to 0..1). */
export function resolveProfile(style: string, own: SimAiPersonality | undefined): AiProfile {
  const preset: Preset = style === 'heavy-hitter' ? AI_PRESETS['heavy-hitter'] : AI_PRESETS.racer;
  const profile: AiProfile = { ...preset, style };
  if (!own) return profile;
  for (const key of NUMBERS) {
    const value = own[key];
    if (value !== undefined && Number.isFinite(value)) profile[key] = unit(value);
  }
  if (own.targetPreference && own.targetPreference.length > 0)
    profile.targetPreference = own.targetPreference;
  if (own.preferredSide) profile.preferredSide = own.preferredSide;
  return profile;
}
