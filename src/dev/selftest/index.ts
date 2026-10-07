// The cross-architecture determinism self-test (docs/architecture.md, "Testing seams"; M1 dev-2):
// `?selftest=1` runs the fixed self-test race (./race.ts) in the browser and compares its final
// state hash with the one Node baked in at build time (vite.config.ts, `virtual:selftest-expected`).
// It shows MATCH or MISMATCH on a panel; the maintainer opens it on the phone.
import { loadSimSteps } from '../../sim/api';
import { createSelfTestRace, type SelfTestRaceResult } from './race';

export type SelfTestStatus = 'MATCH' | 'MISMATCH' | 'not-built';

export interface SelfTestResult {
  status: SelfTestStatus;
  expected: string | null;
  actual: string | null;
  ticks: number;
  /** Wall-clock milliseconds the browser took to run the race. */
  ms: number;
}

export interface SelfTestOptions {
  /** Where the build-time result comes from (tests inject one). */
  expected?: () => Promise<SelfTestRaceResult | null>;
  /** Ticks per slice between yields, so the page stays responsive. */
  sliceTicks?: number;
}

export function selfTestRequested(search: string): boolean {
  return new URLSearchParams(search).get('selftest') === '1';
}

const bakedExpected = async (): Promise<SelfTestRaceResult | null> =>
  (await import('virtual:selftest-expected')).default;

const yieldToPage = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

export async function runSelfTest(opts: SelfTestOptions = {}): Promise<SelfTestResult> {
  const expected = await (opts.expected ?? bakedExpected)();
  if (!expected) return { status: 'not-built', expected: null, actual: null, ticks: 0, ms: 0 };
  // The systems' steps are a lazy chunk (src/sim/late.ts); the app may not have fetched it yet.
  await loadSimSteps();
  const t0 = performance.now();
  const race = createSelfTestRace();
  while (!race.step(opts.sliceTicks ?? 240)) await yieldToPage();
  const actual = race.result();
  const same = actual.hash === expected.hash && actual.ticks === expected.ticks;
  return {
    status: same ? 'MATCH' : 'MISMATCH',
    expected: expected.hash,
    actual: actual.hash,
    ticks: actual.ticks,
    ms: performance.now() - t0,
  };
}

/** Runs the self-test and shows the result on a panel (`#selftest`, `data-status` when done). */
export async function showSelfTest(doc: Document, rendererName: () => string): Promise<SelfTestResult> {
  const panel = doc.createElement('div');
  panel.id = 'selftest';
  panel.setAttribute('role', 'status');
  panel.style.cssText =
    'position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);z-index:1000;' +
    'padding:16px 20px;max-width:90vw;background:#000d;color:#fff;border-radius:8px;' +
    'font:600 16px/1.4 ui-monospace,monospace;text-align:center;pointer-events:none';
  panel.textContent = 'self-test: running…';
  doc.body.append(panel);
  let result: SelfTestResult;
  try {
    result = await runSelfTest();
  } catch (err) {
    result = { status: 'MISMATCH', expected: null, actual: null, ticks: 0, ms: 0 };
    console.error('self-test failed to run', err);
  }
  const colour = result.status === 'MATCH' ? '#5fd35f' : result.status === 'MISMATCH' ? '#ff6b5b' : '#ccc';
  panel.style.borderTop = `4px solid ${colour}`;
  panel.replaceChildren();
  const head = doc.createElement('div');
  head.style.cssText = `font-size:28px;color:${colour}`;
  head.textContent = result.status;
  const detail = doc.createElement('div');
  detail.style.cssText = 'font-size:12px;font-weight:400;opacity:0.85';
  detail.textContent =
    result.status === 'not-built'
      ? 'this build has no self-test hash'
      : `build ${result.expected} · here ${result.actual} · ${result.ticks} ticks in ${Math.round(result.ms)} ms · ${rendererName()}`;
  panel.append(head, detail);
  panel.dataset['status'] = result.status;
  console.log(
    `self-test: ${result.status} (build ${result.expected}, here ${result.actual}, ${result.ticks} ticks)`,
  );
  return result;
}
