---
kind: dev
audience: dev
---
CI's browser tier runs as two parallel slices (`browser (1/2)`, `browser (2/2)`), split by spec file through Playwright's own `--shard`, and slice 2 then runs perf after its e2e. The e2e step was the gate's critical path, about 6 minutes of an 8-minute job, so every PR waited on it. Nothing is dropped: Playwright puts every spec file in exactly one slice, each slice builds and tests its own build, and the deploy ships slice 2's perf build. This is the second try. The first (#166) gave perf a runner of its own, and there the ink look's frame times rose until it failed main; #176 reverted it. This time perf runs after e2e, as it always did. `npm run check -- --tier browser --shard 1/2` runs one slice, `--tier perf` runs perf, and a plain `npm run check` still runs everything with one build.
