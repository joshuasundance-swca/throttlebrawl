---
kind: dev
audience: dev
---
Dependabot now also watches the Hugging Face upload tool the deploys use: its version moved from an inline line in the workflows to `.github/deploy/requirements.txt`, which Dependabot can read. Those bumps wait for review, because the gate never runs an upload. The auto-merge workflow no longer arms a bump of the action it runs itself (`dependabot/fetch-metadata`), and that action now comes in its own PR so the other action bumps still merge on green. AGENTS.md now says a Dependabot-only PR needs no changes note, matching the gate.
