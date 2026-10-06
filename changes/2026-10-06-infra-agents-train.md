---
kind: dev
audience: dev
---
AGENTS.md now says what changes for agents while the bundle train is on (`"live": true` in `.github/train.json`): a PR's own CI is the 3-job quick check, and the train posts `gate` after the full suite passes on a bundle. Lanes arm auto-merge (at the latest once the quick check is green) and finish; the train lands the PR. Keepers watch the train's runs and each PR's `gate` status, fix a train failure or a conflict on the PR's branch, and put "[full-gate]" on a fix for a red main, since the train waits while main is red. "[full-gate]" is otherwise only for an exception that must not wait for a train. The wording holds whether the switch is on or off, so this can land before or after the switch-on PR.
