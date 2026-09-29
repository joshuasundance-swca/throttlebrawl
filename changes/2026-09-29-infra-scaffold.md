---
kind: dev
audience: dev
---
The workshop is in place: the toolchain, `npm run check` (the whole gate, printing what each step examined), the git hooks with the leak scan, CI with a single required `gate` check and auto-merge, and deploys that mirror the source plus the build to the game and staging Spaces. The build is a coloured test screen with a build stamp.

Doc corrections made with it: `hf upload --delete "*"` never removes a Space's `.gitattributes` (huggingface_hub keeps it on purpose), so the repo now tracks its own and the engineering and M1 docs say so; the module-map lint is a small local rule reading `scripts/module-map.mjs`, and the architecture doc names it. lint-staged is on 16.x because 17.x needs Node 22.22.1 or newer, above the repo's Node 22.13 floor.
