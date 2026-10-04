---
kind: changed
audience: player
---
The black-and-white text pop-ups are gone. Rival and cop lines, the style chips ("NEAR MISS ×3 +$75"), the takedown names and the live style meter now run along the top edge as one small dark line at a time, and fade fast. Nothing covers the road. A takedown name ("CATCH OF THE DAY") flashes for under a second and is smaller than the rest. A rival's line still pauses for the flash and comes back. Long-press a rival's line on the strip to cut it, as before.

For devs: the strip is `src/ui/ticker.ts` (the model: eight classes in priority order, merging, queue limits, an injected clock) and `src/ui/ticker-view.ts` (the DOM), replacing the bark bubble and the pop-up stack. `GameUi.ticker.push` is the way in for app/ (asks, landing lines and notes come in the ticker-integration task). Browser seams: `window.__uiTicker(items)` and `window.__uiTickerQuiet`. New tuning slider `hud.tickerNameS`. The HUD layout check measures the strip with the known list still empty; `ui-ticker.spec.ts` measures it in three screen shapes and checks that it paints in all four looks. Not phone-verified.
