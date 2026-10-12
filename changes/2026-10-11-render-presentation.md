---
kind: new
audience: dev
---

The renderer can now apply one complete presentation receipt atomically and accept quality changes
only from its current receipt. Delayed renderer chunks, models and retries cannot replace a newer
presentation. Existing individual setters remain compatible while app receipt adoption follows.

An explicit measurement-to-menu reset clears visual events, reused rider and pedestrian poses,
effects and clocks while keeping loaded assets, vetoes and rendering settings. Preserve mode keeps
those transients, including the pending verge-event queue across its coherent layer rebuild.
These controls verify CPU scene ownership and restoration, without claiming GPU or phone acceptance.
