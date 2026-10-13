---
kind: fixed
audience: player
---

The build label now steps aside when it would cover a startup instruction. This keeps keyboard and touch help readable at Largest text on short screens, including while scrolling. The text-size checks now measure stamp overlap and include a planted overlap to prove the check detects it, with a shortest-landscape case alongside the existing sizes.

The older startup check required the label to remain visible even on the shortest screen. That case now permits hiding only when measured instruction text blocks both corners. The other startup sizes still require a visible label, and the existing control-coverage and tap checks remain.

Three existing recovery-test race completions use the same larger simulation batch as other whole-race browser checks. They still finish the real races and retain every storage, Retry, award and measurement assertion, with the exact recovery/save checkpoints unchanged. This reduces software-rendered test drawing without changing game speed, CI limits or timing estimates.
