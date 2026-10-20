---
kind: fixed
audience: dev
---
Main CI checks for an exact tested-tree proof before scheduling work. An obsolete,
unrecorded intermediate main commit can skip its redundant backstop only after bounded
checks observe an eligible descendant CI run. It remains unaccepted: no green gate,
build, deploy or release. Uncertainty runs the full suite. The train checks the actual
acceptance gate rather than treating routing-only workflow success as accepted main.
