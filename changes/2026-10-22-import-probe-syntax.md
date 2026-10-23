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

The full browser suite gains one slice to fit the new replay coverage inside its existing safety
margin. Its planning weight comes from both complete passing CI cases, with printed-time rounding
allowance. Timeout, safety share, workers, train concurrency, budgets and acceptance stay unchanged;
one full suite uses one additional job. No wall-clock speedup is claimed.
