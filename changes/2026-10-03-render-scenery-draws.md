---
kind: fixed
audience: player
---
The hills no longer show a thin light line where the flat land beside the road meets the slope below it. On San Francisco's Twin Peaks it showed off to the right near the horizon, seen from where Upper Market joins Portola, and it was on every hill road. The slope kept only every third point along its top edge, so on a bend it cut inside the land's curved edge and left a sliver open, and the low ground or the sky showed through. Its top edge now follows the land's edge point for point. A new check walks across that edge on all six hill networks in 2 cm steps: it found 3,057 holes on the Pacific Northwest's hand-made road and 522 on Twin Peaks before the fix, and none after.

The scenery also costs the phone less for the same look, to win back room under the frame budget (up to 108 of 120 draw calls and 133k of 150k triangles before this change):
- Palms, mangroves, shacks, poles, firs, row houses, the sawmill and the islets used to draw one batch per model shape per 256 m square. They now merge into one mesh per 160 m square, built as the camera comes near.
- Past 200 m (a new slider, "Scenery far detail from"), each of them draws as a few blocks in its own colours that keep its outline: 20 to 30 triangles instead of 46 to 492. The roadside props past 120 m do the same.
- Fences and ferns past 40 m leave out faces too thin to see from there, and nothing draws faces nobody can see (a post's foot, a rail's ends, a pylon's top under the deck).

Measured with every route's real scene and models, a chase camera every 25 m (the riders and traffic not included), busiest view before and after:
- Keys standard run: 75 to 68 draw calls, 110k to 87k triangles.
- Pacific Northwest espresso run: 81 to 68 draw calls, 108k to 93k triangles.
- San Francisco Russian Hill: 89 to 73 draw calls, 111k to 93k triangles.
- Twin Peaks: 92 to 68 draw calls, 113k to 88k triangles.

The seam fix adds 10 to 15% to the hill land's own triangles; the totals above include it. The first-load JavaScript grows by 2.4 KB (486.0 of 500 KB). Done, not phone-verified.
