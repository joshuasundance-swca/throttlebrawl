---
kind: dev
audience: dev
---
The staging page now updates only when someone asks for a branch (`gh workflow run staging.yml -f branch=<branch>`), not on every push. On 2026-10-02 it started 223 times and deployed nothing: one shared group let any branch's newer push cancel the run in progress, and its smoke test ran the whole browser suite, which could not finish in its 15 minutes anyway. That cost about 719 runner-minutes in the busiest hours. Its smoke test is now the boot spec alone, which also checks that the page's stamp names the commit. A newer request for the same branch replaces its older run, and requests for different branches take turns on the one Space instead of cancelling each other. The game page is unchanged: every green main still deploys. Docs updated: engineering.md's staging and deploy sections, the README's staging line and the staging Space's short description.
