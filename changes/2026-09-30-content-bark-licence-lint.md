---
kind: dev
audience: dev
---
Two new pack checks for content-2. The `barks` rule fails a bark line whose trigger or `when` fact is not in the vocabulary, or whose op or value cannot match the fact (a word compared with `gt`, a bike class that does not exist); it warns on a number outside the fact's range and on text over 80 characters, and skips vetoed lines. The `licenses` rule fails a file built from licensed source data (OpenStreetMap today) that no matching `licenseRules` entry covers with an attribution; public-domain sources need none, and `packs:check` also fails a licence rule whose licence text is missing from the pack. The base pack gains a public-domain licence rule for `tiger-*` road files, with the Census and USGS courtesy credit, as M2.md asks of the content lane.
