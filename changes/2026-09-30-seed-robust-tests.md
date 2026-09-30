---
kind: dev
audience: dev
---
Two tests no longer depend on how one seeded race happens to turn out. The browser bot race and the UI race test now accept either results screen: a placing and its prize, or Busted and the fine. That is the same rule the headless batch already uses. Rider contact (playtest 1) turned the fixed seed-1 browser race into a bust, and any sim change can flip it again. The resume test's tampered checkpoint now stays an unsigned hash (`>>> 0`). Before, any hash of 2^31 or more turned negative, and the untampered tick 0 read as a desync.
