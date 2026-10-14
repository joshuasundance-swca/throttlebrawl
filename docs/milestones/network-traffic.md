# Traffic through road choices

The maintainer approved this feature on 2026-10-14. One owner delivers network traffic and
Bridge City's Morrison choice together. Ordinary roads use one physical population with
committed lane movements; race progress is never a physical separation coordinate.

## Automated acceptance

- Preserve the selected chain, bounds and seeded population policies of every shipped route
  when branch traffic permission is omitted. Enable only explicitly listed branch roads.
- Preserve individual connector lane rows and directions. Reject illegal forward ingress;
  rider links and shortcut access remain available independently.
- Drive both arms of a fork into a shared receiving queue without duplicate cars or overlapping
  bodies. Cars on separate branches or different-height roads do not collide by race progress.
- Commit seeded legal movements before entry, independent of population random draws. Whole
  bodies occupy connected roads; receiving-space arbitration releases waiting cars fairly.
- Keep one race-wide population cap and reaction clearance around every racer. Protect supported
  and script-owned vehicles from reuse; generation identity prevents stale script ownership.
- Preserve contact rules, near-miss continuity, ghosts, moving decks, smashables and rival/cop
  avoidance across connectors. Preserve finite closed-route traffic bounds.
- Reproduce state and events from identical inputs, including reload around joins and active
  moving decks. Stale recordings recover without altering careers or settings.
- Activate only validated directions on Morrison. Check the real ingress and rejoin, original
  player access, event bonus and the alternate's resulting difficulty.
- Compare matched-count sim/startup/resume cost separately from newly populated gameplay.
  Existing geometry, download and JavaScript budgets remain unchanged.

CI runs the complete gate. The owner performs one coordinated served-build check of both
Bridge City paths, rejoin, retry and reload. Desktop acceptance does not phone-verify feel.

## Defaults and scope

An optional branch `traffic: 'road' | 'none'` controls ambient permission. Omission keeps the
selected-chain policy. Traffic uses only lane-valid directions and excludes road gaps. Choices
are equal seeded shares among distinct available movements, with duplicate rows deduplicated.
Existing finite entry/exit bounds remain; persistent circulation, signals and city destinations
are future work. Internal contracts, consumers, format additions and content ship in one PR.
