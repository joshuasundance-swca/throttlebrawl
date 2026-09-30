---
kind: new
audience: dev
---
Crashes now have somewhere to go. A `crash` event throws the rider and the bike as two tumbling bodies that bounce off the road and the barriers, then parks the bike on the road and has the rider run back to it (steer sideways to dodge) or skip the run, which remounts 3 seconds after the press. Remounting restores full health. A top-speed crash is about 3 seconds of tumble and a second or two of running. Nothing in a race emits `crash` yet: the barrier, fight and traffic crashes from the riders, combat and traffic lanes switch this on for players. Four tuning sliders under "crash": rest time, timeout, skip delay and run speed. The architecture doc gains one `[default]` bullet that fixes the crash event's shape (the actor is the rider who goes down) so those lanes and this one agree.
