import { describe, expect, it } from 'vitest';
import { SIM_STEPS_TEST, simChunkGroup } from './sim-chunk.mjs';

describe('network traffic loading boundary', () => {
  it('keeps network-only traffic rules in the hashed late chunk, with menu/control state early', () => {
    for (const name of ['network', 'network-population', 'path-view', 'merge', 'junctions']) {
      const path = `/src/sim/traffic/${name}.ts`;
      expect(SIM_STEPS_TEST.test(path), name).toBe(true);
      expect(simChunkGroup().test(path), name).toBe(false);
    }
    for (const name of ['index', 'vehicle-control', 'corridor']) {
      const path = `/src/sim/traffic/${name}.ts`;
      expect(SIM_STEPS_TEST.test(path), name).toBe(false);
      expect(simChunkGroup().test(path), name).toBe(true);
    }
  });
});
