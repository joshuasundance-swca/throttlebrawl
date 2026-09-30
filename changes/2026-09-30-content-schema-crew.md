---
kind: dev
audience: dev
---
Contract PR for cops-1 (M1): the content schema learns the `crew` entry type from docs/content-packs.md ("Crew"): `kind` (gang, sponsor-team or law), plus the optional `region`, `stanceTowardPlayer` and `rivalCrews`. The object stays loose, so `gangUp` and later fields pass through. The registry gains a `crews` table; that two-line edit in `src/content/registry.ts` is forced by its typed table map, so it rides along here. The cop lane's law agency file goes in `packs/base/crews/` next.
