---
kind: dev
audience: dev
---
The sim gains one event type, `throw`: a held weapon left the hand, thrown. It is the contract half of "weapons with verbs" (the pitch deck's #4: Kevin's briefcase is thrown and bursts into paperwork). Nothing emits it yet, so play and replays are unchanged. The follow-up PR throws the briefcase. Then `throw` says the thrower's hands are empty from that tick, and the briefcase's later hit or miss, up to a second later, shares the throw's cause id. Audio can hang a whoosh on it, and the weapon audit in the seeded tests can free the thrower's hands at the right tick.
