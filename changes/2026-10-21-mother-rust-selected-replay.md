---
kind: fixed
audience: dev
---

The Mother Rust encounter test replays only the qualifying encounter instead of replaying every rejected search candidate. The original seed search, inputs, qualification rules and time limit stay intact, and the selected encounter still checks its exact replay hash. Rejected candidates no longer log replay hashes, which were never asserted. A focused control and the real encounter check that replay waits for selection.
