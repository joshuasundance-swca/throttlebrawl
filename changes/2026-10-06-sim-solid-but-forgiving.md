---
kind: changed
audience: player
---
Street furniture is solid now, but forgiving. On a city sidewalk (San Francisco's hills, downtown, waterfront and mural alleys, and Key West's Duval Street), the hydrants, lamp posts, traffic-signal posts, street-tree trunks, palms, benches, planters, the plaza orb and the cars in the waterfront lot are really there: hit one square on at speed and you crash; brush it, catch its corner, or ride along its side and you only wobble and slide past it. It is the same rule as meeting a car (the closing-speed rule from the fair-restart change): a hit closing at 10 m/s or more crashes, anything slower or any graze wobbles. Lighter things, parking meters, bins, A-frame boards, rental scooters and scooter racks, you ride through with a wobble and a little lost speed, never a crash. Before, all of these were scenery you rode straight through.

One written rule now decides what touching anything costs (docs/content-packs.md, "Contact outcomes: one rule"), and these outcomes changed to follow it. Each is a default the maintainer may veto:
- The festival barricades on Espresso Row are now ridden through with a wobble, like the set pieces' sawhorse (they were a crash head on).
- Stumps, chainsaw bears, log piles, stair towers and the coffee cart use the closing-speed rule: a slow brush or a graze is a wobble (they crashed from 6 m/s, and from any touch while you were still wobbling).
- Gators, the elk and now the sea lion get out of the way, and if you hit one it is decided by closing speed (big animals crashed at any speed; the sea lion was a ghost you passed straight through).
- A bike left standing while its rider runs back to it is ridden through with a wobble (it had no shape at all), so a bike left on the road after a crash never brings down the rider behind it.

Behind the scenes: where the sidewalk furniture stands is now planned once (src/road/furniture.ts) and both the game's drawing and its physics read that plan, so what you see is what you hit. Everything else in the scenery keeps off any ground you can ride on. This change touches render (it draws the plan) and road (the plan and the land themes moved there) as well as the sim, because the furniture needed one owner. Known gap: Portland's bike racks are still scenery you ride through. Not phone-verified.