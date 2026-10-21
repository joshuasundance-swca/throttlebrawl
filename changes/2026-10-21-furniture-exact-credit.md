---
kind: fixed
audience: dev
---
The furniture avoidance test now credits a furniture fall only when combat names the same rider and crash cause on the next simulation tick, once. A later unrelated takedown of that rider previously could hide an earlier uncredited furniture crash. Missing event identity now leaves the crash uncredited.

The test still counts every rival crash event, including combat falls and already-down body contacts, against the same furniture-off band. Its existing races also print one short cause and fall-versus-contact summary per race to help diagnose a total-crash failure. No game behavior, race selection, crash limit or exposure control changed. The previously observed aggregate failure remains unresolved; this accounting repair does not claim to fix it. Not phone-verified.
