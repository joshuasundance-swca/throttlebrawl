// The cross-architecture determinism self-test (docs/architecture.md, "Testing seams"):
// `?selftest=1` runs one fixed seeded race in the browser and compares its final state hash with
// the one Node baked in at build time. Interface only; dev-2 builds it. The self-test race puts
// every slot on the in-sim AIController and never uses BotController.
export type SelfTestStatus = 'MATCH' | 'MISMATCH' | 'not-built';

export interface SelfTestResult {
  status: SelfTestStatus;
  expected: string | null;
  actual: string | null;
  ticks: number;
}

export function selfTestRequested(search: string): boolean {
  return new URLSearchParams(search).get('selftest') === '1';
}

export function runSelfTest(): Promise<SelfTestResult> {
  return Promise.resolve({ status: 'not-built', expected: null, actual: null, ticks: 0 });
}
