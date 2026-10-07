---
kind: dev
audience: dev
---
Main now reuses the exact source tree a successful full train tested, as it already does for a full PR check. The train uploads its tree record before posting the success statuses that permit landing. Only the main branch's train workflow can vouch; a different tree, fork, expired record, unknown workflow or API error still runs the whole suite. Failed, cancelled or skipped suite results and dry trains create no record. Cancellation after the passed suite and upload can leave valid evidence of that tested tree. An upload failure stops the landing step.

The production-stamped build, squash-commit identity scan and Chromium boot remain mandatory before deployment. Intermediate trees when only part of a bundle has merged still need the full suite. Regression tests first reproduced the missing train reuse and missing pre-landing record, then exercised the real workflow condition for success, failure, cancellation, skips and dry runs. Budgets and test assertions are unchanged. This removes duplicate acceptance work; no wall-clock speedup is claimed before observing the next train landing.
