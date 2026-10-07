import { expect, it } from 'vitest';
import { lakeWaterAt } from './water';

it('uses the actual lake outline and drawn water height, leaving other points at sea level', () => {
  expect(lakeWaterAt('osm-pnw-samish', -1000, -650)).toBe(82.35);
  expect(lakeWaterAt('osm-pnw-samish', 5000, 5000)).toBeNull();
  expect(lakeWaterAt('fixture', -1000, -650)).toBeNull();
});
