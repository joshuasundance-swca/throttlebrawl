# Keep the ferry car deck open at every detail level

`[default]` Repair the rendered opening on the existing PNW ferry road. The distant box simplifier must not seal the drivable car deck or hide traffic underneath. Physics, placement, route choices and ordinary scenery simplification remain unchanged.

## Automated acceptance

- From the existing ferry route start, inspect active drawn triangles at scenery LOD distances 30, 100 and 200 m. Every covered section leaves both traffic lanes clear below the passenger deck.
- The same drawn geometry still contains the roof; hiding the ferry is not a repair.
- The intersection oracle detects a deliberately closed wall. Existing ferry placement, physical opening, draw-call and triangle checks remain intact.
- Preserve ordinary scenery's far stand-ins, draw distances, budgets and collision rules. Run scoped tests, normal hooks/types and the full CI gate.
- Check the served ferry approach at reduced detail. Name the renderer and viewport; desktop rendering does not establish phone performance or recognition at speed.
