# throttlebrawl

A browser motorcycle brawler. Race down a coastal highway, trade punches and kicks with rivals at
speed, weave through traffic coming both ways, and try not to go down anywhere near the cop. It is
built for phones first, with a keyboard that is just as good. `throttlebrawl` is a codename; the
real name comes later.

It is an early work in progress. Right now the build is a coloured test screen with a build stamp,
which proves the whole pipeline from commit to phone.

## Play

- The game: <https://joshuasundance-throttlebrawl.static.hf.space>
- Work in progress, on request: <https://joshuasundance-throttlebrawl-staging.static.hf.space>

Every change that passes the checks goes live on the game page by itself. The staging page shows
the branch someone last asked for, and its stamp says which branch and commit it is.

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
- AI coding agents follow [AGENTS.md](AGENTS.md).
- What changed, in plain words: [changes/](changes/).

## Licence

MIT, see [LICENSE](LICENSE). Third-party assets and their licences are listed in
[THIRD_PARTY_ASSETS.md](THIRD_PARTY_ASSETS.md).
