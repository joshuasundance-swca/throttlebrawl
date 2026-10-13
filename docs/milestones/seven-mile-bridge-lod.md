# Seven Mile bridge drawing repair

The desktop playtest reported solid-looking blocks ahead on the bridge in Speed Monitored by Aircraft, including a block the rider passed through. The event uses the Seven Mile route. Its bridge bays pass through the generic scenery simplifier, whose horizontal boxes fill the gap between separate side walls. [default]

Keep the actual open bridge geometry within the existing bridge draw range. Other scenery keeps its existing simplification. This is a drawing repair; it adds no physical obstacle or road change. Ownership: `src/render/`, its focused unit regression and a change note. [default]

## Automated acceptance

- With the committed Seven Mile kit on both flat and rising roads, visible bridge triangles leave the ride space clear at the default scenery LOD distance and on the forced far path. Inspect the active draw range, with nonempty visible meshes and bridge samples.
- The same intersection check finds the filled ride space in the generic far stand-in, while the actual near model is clear. Retain this negative control.
- Existing bay-placement, grade, gap, draw-reach and merged-mesh checks remain green. CI retains the existing draw-call, triangle and download budgets.
- One coordinated served-game check follows the Seven Mile route on desktop Chromium, examines the rendered bridge ahead at several positions, records the served build and renderer, and checks runtime errors and drawing budgets. Desktop results do not establish phone performance.
