---
kind: dev
audience: dev
---
Dependabot, which is built into GitHub, now checks the npm packages, the workflow actions and the GIS tool's Python packages every week. Small updates (minor and patch) for npm and actions merge on their own once the gate is green. Major updates and the GIS tool's updates wait for someone to review them. Dependabot's own PRs don't need a changes note, Dependabot branches don't deploy to staging, and the gate is unchanged for everyone else.
