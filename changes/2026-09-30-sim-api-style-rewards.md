---
kind: dev
audience: dev
---
Sim contract for M2 riders-5: a race's config now carries the event's style-cash values (`event.style`: cash per near miss, per airtime, per second in the oncoming lane, per takedown with its combo scale, and per steal), read from the event file's `rewards`. A value the file leaves out is 0. The field is optional, so hand-built test configs score no style. Nothing reads it yet; the riders lane's style scoring does next.
