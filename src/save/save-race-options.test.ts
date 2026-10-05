import { describe, expect, it } from 'vitest';
import m1Fixture from './fixtures/settings-v1-m1.json';
import {
  DEFAULT_RACE_OPTIONS,
  DEFAULT_SETTINGS,
  MAX_RACE_RIVALS,
  RACE_KINDS,
  RACE_TRAFFIC,
  RACE_WEATHER,
  sanitiseRaceOptions,
  sanitiseSettings,
} from './index';

// Playtest 4 (P4-12, P4-13): the menu race's options, remembered between races in the settings
// record. Additive: a record from before has none and loads today's race (every option at the
// value that changes nothing), and the version stays 1.

describe('the menu race options in the settings record', () => {
  it('defaults to the race as it was: your bike, any light, local weather, the usual field, cops on', () => {
    expect(DEFAULT_SETTINGS.raceOptions).toEqual(DEFAULT_RACE_OPTIONS);
    expect(DEFAULT_RACE_OPTIONS).toEqual({
      kind: 'race',
      bike: null,
      timeOfDay: null,
      weather: 'local',
      rivals: null,
      cops: true,
      traffic: 'usual',
    });
  });

  it('fills the options in for a record that predates them', () => {
    expect(sanitiseSettings(m1Fixture.data).raceOptions).toEqual(DEFAULT_RACE_OPTIONS);
  });

  it('keeps every well-formed pick', () => {
    const picked = {
      kind: 'race',
      bike: 'region-pnw:supersport-900',
      timeOfDay: 'golden-hour',
      weather: 'rain',
      rivals: 0,
      cops: false,
      traffic: 'heavy',
    };
    expect(sanitiseSettings({ raceOptions: picked }).raceOptions).toEqual(picked);
    for (const weather of RACE_WEATHER) expect(sanitiseRaceOptions({ weather }).weather).toBe(weather);
    for (const traffic of RACE_TRAFFIC) expect(sanitiseRaceOptions({ traffic }).traffic).toBe(traffic);
    for (const kind of RACE_KINDS) expect(sanitiseRaceOptions({ kind }).kind).toBe(kind);
    expect(sanitiseRaceOptions({ rivals: MAX_RACE_RIVALS }).rivals).toBe(MAX_RACE_RIVALS);
  });

  it('drops a bad field back to its default and keeps the others', () => {
    const bad = sanitiseRaceOptions({
      kind: 'demolition-derby',
      bike: 42,
      timeOfDay: 'Golden Hour!',
      weather: 'hail',
      rivals: MAX_RACE_RIVALS + 1,
      cops: 'no',
      traffic: 'gridlock',
    });
    expect(bad).toEqual(DEFAULT_RACE_OPTIONS);
    expect(sanitiseRaceOptions({ rivals: -1 }).rivals).toBeNull();
    expect(sanitiseRaceOptions({ rivals: 2.5 }).rivals).toBeNull();
    expect(sanitiseRaceOptions({ bike: '' }).bike).toBeNull();
    expect(sanitiseRaceOptions({ bike: 'x'.repeat(200) }).bike).toBeNull();
    expect(sanitiseRaceOptions({ cops: false, weather: 'nope' })).toEqual({
      ...DEFAULT_RACE_OPTIONS,
      cops: false,
    });
    expect(sanitiseRaceOptions('not an object')).toEqual(DEFAULT_RACE_OPTIONS);
  });
});
