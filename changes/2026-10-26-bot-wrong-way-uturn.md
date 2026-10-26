---
kind: dev
audience: dev
---

The test bot now turns round when it finds itself riding away from the finish. A jump off one of Eagle Point's Serpentine hairpins can land a rider on the switchback below, facing back down it. The bot used to ride on the wrong way until it met the oncoming queue on the one-lane park loop, and it stayed there: two of four seeded Survey Run races never finished. After half a second facing away from the finish, it now slows and makes the game's own U-turn gesture: a tap of the brake, then a second press held at full lock. It keeps the lock until it faces the finish along the road, then rides on.

Two bot unit tests built their roads so that riding the mirrored direction (`dir -1`) still counted as riding away from the finish. Their finish now lies the way they ride, as on a real route. The new `tests/sim/bot-wrong-way.test.ts` turns the bot round on the real rider system from a standstill, at a roll and at speed. It also keeps a control: a bot that faces the finish never turns. Game physics, riders and content are unchanged.
