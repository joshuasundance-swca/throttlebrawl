// The menu's settings page as data: one change at a time, applied to a copy of the record.
import type { Settings } from '../save';

export type VolumeBus = keyof Settings['volumes'];
export const VOLUME_BUSES: readonly { bus: VolumeBus; label: string }[] = [
  { bus: 'master', label: 'Master' },
  { bus: 'music', label: 'Music' },
  { bus: 'effects', label: 'Effects' },
  { bus: 'voices', label: 'Voices' },
];

export type SettingsChange =
  | { kind: 'volume'; bus: VolumeBus; value: number }
  | { kind: 'mute'; value: boolean }
  | { kind: 'mirror'; value: boolean };

const unit = (v: number) => (Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0);

export function applySettingsChange(s: Readonly<Settings>, c: SettingsChange): Settings {
  const next: Settings = { ...s, volumes: { ...s.volumes } };
  if (c.kind === 'volume') next.volumes[c.bus] = unit(c.value);
  else if (c.kind === 'mute') next.mute = c.value;
  else next.mirror = c.value;
  return next;
}
