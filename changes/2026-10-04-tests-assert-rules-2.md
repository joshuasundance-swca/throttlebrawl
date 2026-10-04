---
kind: dev
audience: dev
---
This finishes the "assert the rule, not today's content" pass. The tests that the first pass left alone, because wave-A lanes owned them then, now read what they check from the packs. A rebalanced count, a renamed rider, a new route or a new region no longer means editing them.

- Career screens and content (`tests/sim/career-screens.test.ts`, `tests/sim/career-content.test.ts`): each objective wording is checked on the first card with that rule, with the rival's name and the counts taken from the event and rider files. Kevin's objective is no longer copied. Claims, secrets, the next event, the teaser and the joke rides come from the career files. The careers match the menu's regions in chapter order. The garage's speeds agree in mph and km/h.
- The career show and grudge rules (`src/career/show.test.ts`, `src/career/grudge-rules.test.ts`): the paper's name, style, deck and caption, the poster's beef lines, the asks, gigs and texts, and every rule card and objective line come from the packs. Each grudge rule now has to be one rival's own and played somewhere.
- The career browser spec (`tests/e2e/career.spec.ts`) reads the opening race, the event waiting on it, the starting cash, bike, paint and shop, and the next career's name and map panel through `tests/e2e/packs-on-disk.ts`. `tests/sim/e2e-oracles.test.ts` checks those picks against the game's own career screens.
- Pedestrians (`tests/sim/traffic-peds.test.ts`): the per-tick checks still ride seeds 1 to 5, all checked in full. If those show no threatened pedestrian or no step onto the road, they ride on, up to seed 16, so the check is always shown able to see what it guards. On 2026-10-04 the five seeds showed only 8 threatened pedestrians. The 50-race batch now loads only for the batch's own tests.
- The radio mixer (`src/audio/radio.test.ts`): the R key and the tuning slider step through the dial in its own order, read from the packs. No station is pinned to a slider stop.
- The cast and the law (`tests/sim/app-cast-and-law.test.ts`): the cop's weapon is his rider file's starting weapon. The tier-1 fine is the law file's own. The weaver and the heavy hitter are found by style, and every style in the field must ride differently from the others.
- Roadside scenes (`src/render/scenes/scenes.test.ts`): there is one scenes file per region, with no count of 3. The pitch's three scenes are still checked word for word, because the pitch is the spec, but a scene the maintainer vetoes leaves both checks.
- `docs/engineering.md`, in the gate's "Assert the rule" bullet, says where browser specs read the packs and how a test picks its content.

Each converted test was shown to fail on a broken rule before the rule was restored. A few content changes were also tried on purpose and passed: Kevin's knockdown count, the boss's count, a new real route, and a vetoed pitch scene. Budgets, determinism, replay, layout, geometry and reachability checks are unchanged. The two browser specs were not run locally, because lanes run no browser. CI runs them.
