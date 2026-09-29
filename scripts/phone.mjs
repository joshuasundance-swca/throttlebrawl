#!/usr/bin/env node
// npm run phone: forwards the dev server (5173) and `vite preview` (4173) to a connected Android
// phone with `adb reverse`, so the phone opens http://localhost:<port>, a secure context
// (docs/engineering.md, "Phone testing"). Pair and connect the phone first. ADB overrides the
// adb binary.
import { spawnSync } from 'node:child_process';

const adb = process.env.ADB || 'adb';
const run = (args) => spawnSync(adb, args, { encoding: 'utf8' });

const devices = run(['devices']);
if (devices.error) {
  console.error(`phone: cannot run ${adb}. Install Android platform-tools, or set ADB to its path.`);
  process.exit(1);
}
const listed = devices.stdout.split(/\r?\n/).filter((l) => /\tdevice$/.test(l));
if (listed.length === 0) {
  console.error(
    'phone: no device listed by adb devices. Pair and connect first (docs/engineering.md#phone-testing).',
  );
  process.exit(1);
}
for (const port of [5173, 4173]) {
  const res = run(['reverse', `tcp:${port}`, `tcp:${port}`]);
  if (res.status !== 0) {
    console.error(`phone: adb reverse tcp:${port} failed: ${res.stderr.trim()}`);
    process.exit(1);
  }
}
console.log(`phone: ${listed.length} device(s) connected; ports 5173 and 4173 forwarded.`);
console.log('  npm run dev      -> open http://localhost:5173 on the phone');
console.log('  npm run preview  -> open http://localhost:4173 on the phone');
console.log('  chrome://inspect on the desktop shows the phone tab.');
