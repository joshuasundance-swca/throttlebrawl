---
kind: fixed
audience: dev
---
Moving pedestrian footprints can query physical ground without filling the exact-point result cache with coordinates they continually leave behind. The cached and uncached paths share the same ordered road candidates and section-versus-triangle winner; height ceilings, source-terrain priority and the own-section exclusion retain their existing rules. Flight and forecast callers keep the cached query.

All nine pedestrian footprint probes, continuous sweep spacing, water checks and supporting-floor state remain. The differential tests cover curved ground, stacked terrain, gaps, changing ceilings, own sections, nonfinite and signed-zero inputs, and nested queries. The pedestrian observer still compares the entire published probe sequence and movement result. Its footprint-transform measurement now excludes physical-query work explicitly, rather than relying on that query having a warm result cache. This is an allocation optimization, not a looser physics or performance budget; matched cost measurements and full CI remain necessary.
