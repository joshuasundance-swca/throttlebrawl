import { describe, expect, it } from 'vitest';
import { basePackFiles, buildRegistry, type PackFile } from '../index';

const agency = {
  type: 'crew',
  id: 'test-deputies',
  name: 'Test Deputies',
  kind: 'law',
  region: 'florida-keys',
  stanceTowardPlayer: 'hostile',
  rivalCrews: [],
};

function withCrew(json: Record<string, unknown>, path = 'crews/test-deputies.json'): PackFile[] {
  return [...basePackFiles(), { path, json }];
}

describe('content schema: crew', () => {
  it('loads a law crew into its own table', () => {
    const reg = buildRegistry(withCrew(agency));
    expect(reg.crews['base:test-deputies']?.kind).toBe('law');
    expect(reg.index.some((r) => r.type === 'crew' && r.id === 'test-deputies')).toBe(true);
  });

  it('refuses an unknown crew kind, naming the file and the field', () => {
    expect(() => buildRegistry(withCrew({ ...agency, kind: 'navy' }))).toThrow(
      /crews\/test-deputies\.json \/kind/,
    );
  });
});
