---
kind: fixed
audience: dev
---

When a lone pull request's assembled train tree exactly matches its head tree, a failed full train
suite now leaves the pull request red without repeating the same source content through all 23 jobs.
Its report says the exact tree failed once, excludes a composition failure, and leaves persistence
versus transience unproven; a new push remains the retry path for a suspected flake. Unequal trees
still run the existing branch control.

This removes the automatic second full sample and its alternate build stamp for the exact-tree case.
Equal source trees do not promise byte-identical builds because train and control use different build
identifiers and branch labels. Main-red, timeout, cancellation, split, tested-tree and deployment
rules are unchanged.
