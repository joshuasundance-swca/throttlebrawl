---
kind: fixed
audience: player
---
Hits now happen where things look like they are. The "give trucks a wider berth" feeling was real on bends: traffic contacts were measured along the curve of the road, while each vehicle is drawn as a straight, rigid body, so on a winding road a long truck's hitbox reached up to half a metre past the truck you could see (a log truck on the Gorge: 0.57 m), and you crashed into air beside or behind it. Contacts now use the vehicle as drawn. On the Gorge, crashes and wobbles against big vehicles happened with the drawn shapes 0.30 m apart at the 90th percentile before; after, none of 27 sat more than 0.2 m apart.

Every other collidable thing was checked against its drawn shape too, and fixed where they disagreed by more than 0.15 m a side:
- Rails and walls are drawn where the game stops you. They used to stand 0.55 m out on the verge, so you could never touch the rail you were scraping.
- A ramp truck's side is met by your bike's side, not its middle (the bike used to sink 0.4 m into the truck before it scraped), and its solid body now ends at its drawn cab (it reached 0.95 m past it).
- Every bike is drawn the size of the rider's hitbox: the chopper and the big tourers are drawn a little smaller, the mobility scooter a little larger. The wide, short trike and lawnmower are the closest compromise and still miss by up to 0.17 m; a proper fix needs a hitbox per bike.
- The café tables' hitbox now covers their chairs. The firewood stand, the hay bale and the flare are narrower, and the sawhorse's splayed feet now count. The PNW barricades are as deep as they are drawn, the log piles fill their whole hitbox, and a stump's root no longer pokes out past its hitbox.
- The car carrier's lowered ramp is drawn as wide as the ramp you ride: 2.3 m, where it was 1.8 m on a 2.4 m deck.
- The island road train is drawn full length.
- Animals are drawn inside their hitboxes, as vehicles already are: a pelican's beak, a gator's tail and splayed legs, and an elk's head used to reach past theirs. The pelican, gator, dogs and rooster got hitboxes the size they are drawn, so they look the same. The elk's hitbox is its body's width (0.6 m), not its antlers' (0.9 m).
- The PNW cargo bike's hitbox is no wider than the bike (0.6 m, was 0.8 m). The SF scooter commuter, drawn as a person, has a person's hitbox (0.5 m long, was 0.9 m).

For devs: `scripts/hitboxes.test.ts` is the audit and the per-PR rule. It compares every traffic type, bike, smashable, set-piece prop, solid road hazard, ramp truck, the moving carrier and the barriers, sim box against drawn footprint, within 0.15 m each end and side. It has negative controls and four named exceptions, each with its reason and a bound. Run `HITBOX_TABLE=1 npx vitest run --project unit scripts/hitboxes.test.ts` to print the table.

The rest:
- `tests/sim/traffic-drawn-contact.test.ts` rides the Gorge and measures every traffic contact on the drawn shapes. It has a negative control, and it fails on the old rule (6 contacts 0.21 to 0.57 m from the drawn log truck).
- Sim: `sim/traffic` `rigidOffset` covers the contacts only. Outcome rules are untouched; a separate lane owns them. Other sim changes: `sim/riders` `truckSideContact`, `TRUCK_STEP_OUT_M`, the smash `KIND_SPEC` sizes and the set-piece `extent`.
- Data: the 23 parked ramp trucks in the region roads (and their 8 entries in the GIS sources) are now 21.1 m long. The PNW espresso-row barricades are 0.6 m deep.
- Data: the animal and pedestrian sizes above (`packs/*/traffic`).
- Render: `views.ts` fits the scaled animal figures as #537 fits vehicles (`isScaledPedFigure`). Also `riders/bake.ts` `bikeFitScale`, `BARRIER_OUT_M` and `RAILING_OUT_M`, the carrier ramp, the road train, the flare glow, the stump root and the log pile. `pnw-places.ts` `solidHazardModel` is extracted unchanged for the audit.

Seeded races shift a little: traffic contacts on bends, prop and smashable sizes, ramp-truck lengths. Determinism is unchanged; the contact maths uses the core trig.

Not covered:
- Heights: traffic contact is the same 1.2 m for every vehicle, and tumbling bodies use 1.5 m or 3.2 m boxes, whatever is drawn. A per-type height is a pack-schema change.
- The rider models on the bikes were not measured (they live in the dataset).
- Not phone-verified.

Keeper fix (after main's slow-bumps-wobble change, #552): `tests/sim/traffic-drawn-contact.test.ts` measured each contact only at the snapshots before and after its tick. A fast rider grazing an oncoming log truck's corner now wobbles and is pushed clear, so neither snapshot held the touch (0.89 m before, 0.23 m after, on seed 1). The test now also measures the pose the sim tests a contact at: the rider moved on one tick by its speed and heading, before the push. It passes (89 contacts, 27 with big vehicles, none over 0.2 m) and still fails with the corridor boxes put back (3 contacts in the air).
