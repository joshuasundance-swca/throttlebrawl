export const files = [
  'tests/fixtures/landing-reporter/a.case.ts',
  'tests/fixtures/landing-reporter/b.case.ts',
  'tests/fixtures/landing-reporter/c.case.ts',
];
export const cases = files.map((file, i) => ({
  event: 'fixture:event',
  route: `route:${i}`,
  seed: 1,
  thumb: i === 2,
  key: `key:${i}`,
  file,
}));
export const landingManifest = () => ({
  files,
  cases:
    process.env.LANDING_FIXTURE_SCENARIO === 'missing'
      ? [...cases, { ...cases[0]!, key: 'key:missing' }]
      : cases,
});
export const sidewalkManifest = () => ({
  files,
  cases: landingManifest().cases.map((c, i) => ({
    key: c.key,
    file: c.file,
    region: `fixture-region:${i}`,
    eventId: 'fixture:event',
    seed: c.seed,
    mode: 'fast' as const,
  })),
});
