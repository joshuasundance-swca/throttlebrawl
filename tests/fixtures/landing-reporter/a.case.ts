import { test } from 'vitest';
import { runCase } from './case.ts';
test('fixture bot-a', (ctx) => runCase(0, ctx));
if (process.env.LANDING_FIXTURE_SCENARIO === 'duplicate')
  test('fixture duplicate bot-a', (ctx) => runCase(0, ctx));
