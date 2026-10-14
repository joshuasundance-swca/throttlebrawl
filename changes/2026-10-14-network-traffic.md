---
kind: new
audience: player
---
Bridge City's Morrison choice now carries ordinary forward traffic. Cars choose a legal bridge
path and join the shared road again, with room for the whole vehicle and priority for waiting turns.
The rider's original shortcut entrance remains available.

For devs: traffic on road choices uses one physical population and committed lane movements.
Permission is authored independently of shortcut/alternate labels; omission keeps the old selected
chain. Scripted vehicle ownership includes a generation, supported vehicles are protected from
reuse, and rival/cop sensing crosses short connectors. Roadside props use physical contact and
visibility across roads. The existing population, size and rendering budgets remain.

Traffic-only turns close their terrain even without reciprocal rider links, and surrounding
streets supply their scenery instead of generating another row of buildings. The GIS width
check still requires four-metre ordinary lanes; dedicated traffic turns use their authored width.
Sparse solid road fragments batch with one adjacent dense chunk, preserving all triangles and
fine-detail distance culling while keeping junction camera views inside the existing budgets.
Historical downtown comparison still holds the original road cohort; current-city tests hold
building clearance, land support and scenery on streets, with no duplicate row on traffic-only
turns. The new turn retains its actual parent roads' source records and attribution bytes.

This changes simulation/replay identity. An in-progress recording from another build follows the
existing stale-race recovery; career and settings formats are unchanged. Rewards and rival pace
are unchanged. Desktop checks do not establish phone feel or the shortcut's resulting advantage.
