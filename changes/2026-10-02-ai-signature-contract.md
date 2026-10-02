---
kind: dev
audience: dev
---
Contract for rivals' signature moves (interview, 2026-10-02: "Visible personalities"). A rider file can name one move in `personality.signature`. `SIGNATURE_IDS` lists the eleven moves, and `buildSimConfig` passes the move on to the sim. Each entity's snapshot gains a `signature` field: the move, its phase (`tell`, `act` or `open`), the seconds into and left in that phase, and whom the move is aimed at. The field is null until the AI lane drives the moves, which comes next. Render can use it to draw Chad's phone, the Mayor's wave and Gus's bell.
