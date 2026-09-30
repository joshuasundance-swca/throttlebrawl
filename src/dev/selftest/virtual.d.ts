// The self-test race's result, baked in at build time by vite.config.ts (null before it existed).
declare module 'virtual:selftest-expected' {
  const expected: { hash: string; ticks: number; seed: number; movers: number } | null;
  export default expected;
}
