---
kind: new
audience: player
---
Signs now look like they belong where they stand. Until now every sign in every region was the same green. Now the Keys' signs are bright mile-marker green on white posts, the Northwest's are mossy, cedar-routed town signs, San Francisco's are blue-green street blades on black iron, the Columbia River Gorge's are brown heritage-route signs with a cream rule, and I-5's are deep-green guide signs with a white border. Billboards and the incident-site cones look as they did, and a region with no style keeps today's green.

For devs: a region file's optional `signStyle` sets the face of its signs, and a road's `billboard` slot can override it with `params.style` (the Gorge and I-5 slots do, in the road files and their bake configs). The names are `mile-marker`, `historic`, `guide`, `blade` and `town`. A name the renderer does not know counts as absent, and `src/app/regions.test.ts` fails on one. The change is `src/render/boards.ts` (`SIGN_FACES`, `styleOfSlot`), `src/app/regions.ts` (`boardCatalog` carries the style), `docs/content-packs.md` (Region and "Signs and billboards"), and a rule test in `src/render/sign-faces.test.ts`. The faces are colours only, so every sign's words fit as before. The colours are from memory of the places and not checked against a source. Not browser-run; not phone-verified.
