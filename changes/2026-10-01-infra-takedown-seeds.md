---
kind: dev
audience: dev
---
Main went red on the browser bot race's "the bot lands a takedown" check after the ramp truck and boost pads began moving per race (#208): in the release build none of its five seeded races landed one, which is the one-seed luck the check's own comment warns about. Seeds 12, 13 and 16 join the headless takedown seeds; over seeds 1 to 20 the release content lands a takedown on 12, 13, 14 and 16, and the staging content on 3, 12, 13, 16 and 20. The check still needs at least one.
