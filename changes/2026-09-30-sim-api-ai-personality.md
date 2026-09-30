---
kind: dev
audience: dev
---
Contract PR for ai-1 (M1): a rival's own personality numbers now reach the sim. `SimController`'s `ai` variant gains an optional `personality` (`SimAiPersonality`: `aggression`, `dirtiness`, `courage`, `riskTaking`, `chatter`, `weave`, `targetPreference`, `preferredSide`), exported from `src/sim/api.ts`. `buildSimConfig` fills it from the rider file through the new `aiController`, which keeps only well-typed fields; sim/ai lets these numbers override the style preset, as the content-pack doc's rider format says. `weave` (a lane habit, 0..1) is new; ai-1 documents it with the rider format. The `src/app/config.ts` change is the one-function wire that populates the new field, kept in this PR so the field is never half-connected.
