---
kind: fixed
audience: dev
---

The police-radio race search now releases event-tick world snapshots that it never reads, instead of retaining them across unsuccessful seeds. Its complete event history, first snapshot, seed search, race simulation, tick budgets and timeout remain unchanged. Other police checks still retain their event-tick snapshots by default.

The jurisdiction check also reruns its qualifying race without retained snapshots and verifies the same events, first snapshot, player, finish status and tick count. This reduces unnecessary retention; a local passing radio search does not establish a CI timing improvement.
