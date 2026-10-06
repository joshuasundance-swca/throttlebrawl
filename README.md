# throttlebrawl

A browser motorcycle brawler. Race down a coastal highway, trade punches and kicks with rivals at
speed, weave through traffic coming both ways, and try not to go down anywhere near the cop. It is
built for phones first, with a keyboard that is just as good. `throttlebrawl` is a codename; the
real name comes later.

It is a work in progress, and it is playable: you can race a field of rivals on a road with traffic,
fight from the saddle, and play a career, on the page below. What is built and what is planned is in
the [roadmap](docs/roadmap.md).

## Play

- The game: <https://joshuasundance-throttlebrawl.static.hf.space>

Every change that passes the checks goes live on the game page by itself.

## Run it locally

You need Node.js 22 (the exact version is in `.nvmrc`) and npm.

```bash
npm ci
npm run hooks:install              # git hooks: leak scan, lint and format, typecheck and tests
npx playwright install chromium    # the browser for the end-to-end tests
npm run dev                        # http://127.0.0.1:5173
npm run check                      # the whole gate, printing what each step examined
```

To play the dev build on an Android phone, see [phone testing](docs/engineering.md#phone-testing)
and `npm run phone`.

## How it is built

- [Product spec](docs/product-spec.md): what the game is, and the v1 launch bar.
- [Roadmap](docs/roadmap.md) and the milestone plans in [docs/milestones/](docs/milestones/).
- [Architecture](docs/architecture.md): the module map, the simulation and its determinism rules.
- [Engineering](docs/engineering.md): the gate, CI, deploys and how parallel agents work.
- [Content packs](docs/content-packs.md) and the [tone guide](docs/tone-guide.md).
- Want to change something? Read [CONTRIBUTING.md](CONTRIBUTING.md): how a pull request gets checked and merged.
- AI coding agents follow [AGENTS.md](AGENTS.md).
- What changed, in plain words: [changes/](changes/).

## Licence

MIT, see [LICENSE](LICENSE). Third-party assets and their licences are listed in
[THIRD_PARTY_ASSETS.md](THIRD_PARTY_ASSETS.md).
