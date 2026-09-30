// The same declaration as src/dev/selftest/virtual.d.ts, for the Node-side type check
// (tsconfig.node.json), whose tests and tools import src/dev.
declare module 'virtual:selftest-expected' {
  const expected: { hash: string; ticks: number; seed: number; movers: number } | null;
  export default expected;
}
