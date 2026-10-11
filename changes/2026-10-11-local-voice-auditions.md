---
kind: dev
audience: dev
---

# Optional local voice comparisons

Added a bounded audition script for original English Chatterbox using already prepared
synthetic cast references. It compares existing bark lines with named delivery settings,
keeps raw audio and decoded Opus measurements, and records complete segment provenance.
Existing output and shipped-content destinations are refused. It does not download models,
load provider credentials or apply clips to the game.

Pure tests cover validation, exact and vetoed line selection, cast reference provenance,
segment controls and cleanup, matched seeds, output isolation and overwrite refusal.
Actual model compatibility and delivery quality require runtime generation and listening;
the manifest leaves these verdicts pending.
