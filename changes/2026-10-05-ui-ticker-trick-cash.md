---
kind: fixed
audience: player
---
A paid flip's cash now always reaches the top strip. Landing a double backflip off a hood launch used to show only the landing one-liner ("TEN OUT OF TEN, SAYS A PELICAN"); the "BACKFLIP +$240" chip, the biggest payout in the game, was dropped behind it. Now the line shows, then the chip, and a paid chip is never dropped: it waits behind a rival's line or a hint and comes back after anything that takes the strip from it. Chips with no cash (such as "DRIFT LOST") still go stale as before.

Two smaller fixes. The slow-frames offer showed twice, as the floating card and as a line on the strip; it now shows once, as the card with its two buttons. And long-pressing a landing line to cut it now offers it as a sign by its words, not as a rival's line with an empty speaker.

For devs: `src/ui/ticker.ts` (`isPaidStyle`: never expires, is frozen when taken, is not counted against the queue limit), `src/ui/narrative/veto.ts` (`seenItemOf`), `src/app/ticker-feed.ts` (the slow-frames ticker item is gone). `docs/architecture.md` "One top ticker" is updated. Not phone-verified.
