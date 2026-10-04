---
kind: fixed
audience: dev
---
The browser bot race no longer waits five minutes for a halfway point that never comes when the bot is busted early. A bust ends the race at once, and the spec already accepted "Busted" on the results screen, but its halfway wait only looked at the bot's progress. Now the wait also ends when the race does, and the midway screenshot prints NOT ACTIVE for that race. Found when the kerb riders (#441) reshuffled seed 1 into a bust at tick 4327.
