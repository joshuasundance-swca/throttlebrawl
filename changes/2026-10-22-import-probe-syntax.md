---
kind: fixed
audience: dev
---

The real-folder import check now reads TypeScript syntax, so quoted test fixtures and comments no
longer become imaginary imports. Actual static imports, re-exports, bare imports, literal dynamic
imports, import types and import-equals declarations still reach the existing boundary checks,
including double-quoted and literal-template specifiers the old text match could miss. Regression
fixtures preserve detection of a real forbidden import; no module boundary or source-file selection
was relaxed.
