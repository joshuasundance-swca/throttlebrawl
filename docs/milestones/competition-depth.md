# Quick Play competition depth

The maintainer approved the recommended Quick Play event access and representative bike differentiation batch on 2026-10-10: "Please proceed as recommended." `[decided]` The boss prototype follows this batch. This plan's implementation choices are `[default]`.

## Scope

Expose existing Race, Hunt, Escape and Grudge events in Quick Play, with understandable objectives and workable setups. Tune a small set of existing bikes to offer handling tradeoffs beyond top speed. Preserve career progression, ordinary clean racing, replay determinism and save compatibility. No new event kinds, paid generation or budget increases.

Quick Play prefers the lowest-tier workable event in each family and excludes regional finales. A tier boss can supply the introductory Grudge. Hunts and Grudges retain their authored road; named-target Hunts and Grudges retain their authored opposition. Other Hunts enforce enough rivals, and Escape enforces active law. Race and Escape retain the route picker. The setup screen explains these constraints. `[default]`

## Automated acceptance

1. Each loaded region offers its existing supported event kinds, with a deterministic available event for each choice. Missing or removed event families fall back safely. Content additions do not require a hardcoded event list.
2. The chosen event reaches the actual race config and objective display. Hunt has enough reachable targets, Escape has active law, and Grudge includes its named opponent. Conflicting setup options cannot silently create an impossible objective.
3. Device reload and Quick Play Retry preserve the selected event family and valid setup. The family is a top-level device setting so an older build preserves it through an unrelated settings save; the legacy nested race type remains Race. Older or invalid settings retain their defaults. Selecting and racing Quick Play do not change career progress, cash, bike ownership or grudges; career races retain their own event and field.
4. Event controls, objective explanation and primary actions remain reachable by touch and keyboard at small landscape sizes and all supported text sizes. Existing location, route and bike choices continue to work.
5. A small representative set of existing bikes exhibits measured acceleration, cornering/braking and stability or stunt tradeoffs using actual pack data and fixed sim inputs. Tests compare observable behavior, include a same-handling control, and do not simply repeat tuned numbers. Top speeds, prices and unlocks stay unchanged unless a documented technical need is discovered.
6. Same-bike opposition resolves the selected bike's actual handling for every rival. Default handling and deterministic replay controls remain valid; no global physics perk or automatic stunt success is introduced.
7. Existing CI acceptance, leak scanning and performance budgets remain green. The coordinator performs one scoped check on the served build after deployment. Desktop browser dimensions do not establish phone verification.

## Ownership

The event lane owns app, UI and save integration. The bike lane owns representative bike content and rider behavior tests. The coordinator owns this plan, contract adjudication, integration, publication and the browser slot. Changes to shared formats or sim contracts are proposed before implementation and land separately when required.
