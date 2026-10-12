---
kind: dev
audience: dev
---
Expose additive observations immediately after successful scene rendering, using the game loop's raw accepted animation-frame timestamp. App-owned epochs separate race replacements, pauses, hidden pages, context holds, foreground loading, countdowns and normalized lockstep changes, including interruptions between draws. Fast-forward's final frame stays synthetic after returning to real time. Missing poses, known context loss and rendering errors produce no sample. Frozen samples and isolated listener failures protect other subscribers and existing gameplay hooks. This is CPU render-call completion, not a screen-presentation or phone-performance verdict; no soak session is started.
