import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, RACE_TRAFFIC, RACE_WEATHER, sanitiseSettings, type Settings } from '../save';
import { raceOptionRows, stepRaceOption, type RaceOptionsView } from './race-options';

// Playtest 4 (P4-12, P4-13): the menu race's options screen as data. One row per option, each a
// list of choices stepped through with the arrows; every step is a settings record the save keeps,
// so the pick is remembered between races and reloads.

const VIEW: RaceOptionsView = {
  where: 'The Keys, Overseas Highway',
  bikes: [
    { value: null, label: 'Garage bike', note: 'Rustbucket 400' },
    { value: 'base:moped', label: 'Rental Moped', note: '50 mph' },
    { value: 'base:superbike-1000', label: 'Superbike 1000', note: '160 mph' },
  ],
  times: [
    { value: null, label: 'Any' },
    { value: 'dawn', label: 'Dawn' },
    { value: 'dusk', label: 'Dusk' },
  ],
  rivals: [
    { value: null, label: 'Usual', note: '4 rivals' },
    { value: 0, label: 'None' },
    { value: 1, label: '1' },
    { value: 7, label: '7' },
  ],
  lengths: [
    { value: 'short', label: 'Short' },
    { value: 'standard', label: 'Standard' },
  ],
};

const ids = (s: Settings, v = VIEW) => raceOptionRows(v, s).map((r) => r.id);
const row = (s: Settings, id: string, v = VIEW) => raceOptionRows(v, s).find((r) => r.id === id);
const shown = (s: Settings, id: string) => {
  const r = row(s, id);
  return r?.choices[r.index]?.label;
};

describe('the race options screen as data', () => {
  it('shows every option with a choice to make, at the record’s values', () => {
    expect(ids(DEFAULT_SETTINGS)).toEqual([
      'bike',
      'time',
      'weather',
      'rivals',
      'cops',
      'difficulty',
      'length',
      'traffic',
    ]);
    // The defaults are the race as it was.
    expect(shown(DEFAULT_SETTINGS, 'bike')).toBe('Garage bike');
    expect(shown(DEFAULT_SETTINGS, 'time')).toBe('Any');
    expect(shown(DEFAULT_SETTINGS, 'rivals')).toBe('Usual');
    expect(shown(DEFAULT_SETTINGS, 'cops')).toBe('On');
    expect(shown(DEFAULT_SETTINGS, 'traffic')).toBe('Usual');
    expect(shown(DEFAULT_SETTINGS, 'difficulty')).toBe('Normal');
    expect(shown(DEFAULT_SETTINGS, 'length')).toBe('Standard');
    // The race type is a seam (P4-12's new types are [open]): no row while there is one type.
    expect(ids(DEFAULT_SETTINGS)).not.toContain('kind');
  });

  it('hides a row with nothing to choose, and the length while the picked road sets it', () => {
    const roadPicked = { ...VIEW, lengths: [], times: [{ value: null, label: 'Any' }] };
    expect(ids(DEFAULT_SETTINGS, roadPicked)).not.toContain('length');
    expect(ids(DEFAULT_SETTINGS, roadPicked)).not.toContain('time');
  });

  it('steps each row forward and back through all its choices, wrapping, and the save keeps every step', () => {
    for (const id of ids(DEFAULT_SETTINGS)) {
      const n = row(DEFAULT_SETTINGS, id)?.choices.length ?? 0;
      expect(n, id).toBeGreaterThan(1);
      let s: Settings = DEFAULT_SETTINGS;
      const seen: string[] = [];
      for (let i = 0; i < n; i++) {
        s = stepRaceOption(VIEW, s, id, 1);
        seen.push(String(shown(s, id)));
        // Saved and loaded again, the pick is the same.
        expect(shown(sanitiseSettings(JSON.parse(JSON.stringify(s))), id), `${id} after a reload`).toBe(
          shown(s, id),
        );
      }
      expect(new Set(seen).size, `${id} visits every choice`).toBe(n);
      expect(shown(s, id), `${id} wraps back to the start`).toBe(shown(DEFAULT_SETTINGS, id));
      // Back from the default is the choice before it, wrapping to the last from the first.
      const at = row(DEFAULT_SETTINGS, id)?.index ?? 0;
      expect(shown(stepRaceOption(VIEW, DEFAULT_SETTINGS, id, -1), id), `${id} steps back`).toBe(
        row(DEFAULT_SETTINGS, id)?.choices[(at - 1 + n) % n]?.label,
      );
    }
  });

  it('writes each option where the race reads it: the options record, the difficulty and the race length', () => {
    let s = stepRaceOption(VIEW, DEFAULT_SETTINGS, 'bike', 1);
    expect(s.raceOptions.bike).toBe('base:moped');
    s = stepRaceOption(VIEW, s, 'cops', 1);
    expect(s.raceOptions.cops).toBe(false);
    s = stepRaceOption(VIEW, s, 'rivals', 1);
    expect(s.raceOptions.rivals).toBe(0);
    s = stepRaceOption(VIEW, s, 'difficulty', 1);
    expect(s.difficulty).toBe('hard');
    s = stepRaceOption(VIEW, s, 'length', -1);
    expect(s.raceLength).toBe('short');
    expect(RACE_WEATHER).toContain(stepRaceOption(VIEW, s, 'weather', 1).raceOptions.weather);
    expect(RACE_TRAFFIC).toContain(stepRaceOption(VIEW, s, 'traffic', 1).raceOptions.traffic);
    // Nothing else in the record moves.
    const { raceOptions: _o, difficulty: _d, raceLength: _l, ...rest } = s;
    const { raceOptions: _o2, difficulty: _d2, raceLength: _l2, ...before } = DEFAULT_SETTINGS;
    expect(rest).toEqual(before);
  });

  it('a pick this region does not offer shows the first choice, and the next step moves on from there', () => {
    const elsewhere: Settings = {
      ...DEFAULT_SETTINGS,
      raceOptions: { ...DEFAULT_SETTINGS.raceOptions, timeOfDay: 'night', bike: 'base:lost-bike' },
      raceLength: 'long',
    };
    expect(shown(elsewhere, 'time')).toBe('Any');
    expect(shown(elsewhere, 'bike')).toBe('Garage bike');
    // An event without the saved length races its standard one, so that is what shows.
    expect(shown(elsewhere, 'length')).toBe('Standard');
    expect(stepRaceOption(VIEW, elsewhere, 'time', 1).raceOptions.timeOfDay).toBe('dawn');
  });

  it('an unknown row changes nothing', () => {
    expect(stepRaceOption(VIEW, DEFAULT_SETTINGS, 'nope' as 'bike', 1)).toEqual(DEFAULT_SETTINGS);
  });
});
