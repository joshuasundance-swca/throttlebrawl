# Gameplay and menu refinement, October 2026

The maintainer withdrew the Old Seven Mile highway-only participant rule on 2026-10-10 and chose gameplay refinement and menu redesign together. See [the decision record](../playtests/interview-2026-10-10.md). The following implementation choices are `[default]`; the broader interview is context rather than approval to build every discussed idea.

## Scope and ownership

- Camera/sim/content: retain takedown celebration while keeping the road visible; allow occasional capable Old Seven Mile participants; set existing hunts and escapes up around their activity.
- UI: a clear Career, Quick Play and Settings entry; location and race setup inside Quick Play; pause and results primary actions separate from scrolling details.
- App/save integration: optional matched-bike Quick Play competition alongside the existing open field, remembered as an additive device setting. Career remains independent.
- No new objective kinds, services, paid assets, budget increases or changes to launch authorization.

## Automated acceptance

1. Takedown framing retains the forward road direction with and without slow motion; look-back, helmet, reduced-motion and high-fall behavior retain their existing controls. Test framing from actual camera output, not a mode label alone.
2. Old Seven Mile admits some rivals and police without making every rival choose it; navigation handles its gap/exit. An explicitly barred branch still excludes participants, using a separate negative control rather than freezing this route's old policy.
3. Hunts begin with reachable rivals and escapes establish an actual pursuit promptly. Existing objective pass/fail cases hold; good riding does not require waiting merely to activate the event. Ordinary race/grudge starts retain their semantics.
4. Quick Play offers open and matched competition. Matched rivals use the selected player's bike and an appropriate pace; open competition and career field levels retain their previous behavior. A selected cross-pack bike is available to the race and represented in the replay config.
5. Missing or invalid field settings default to open; matched survives save/reload without changing the settings version. No career progress, cash or grudges are changed by setup.
6. Main navigation, Quick Play setup and Back are reachable by touch and keyboard. Region/route/remembered settings still reach the race; secondary menu functions remain accessible.
7. Pause, Quick Play results and career results keep primary actions visible outside scrolling details at small landscape sizes and the supported text sizes. Browser tests inspect rendered bounds, focus/navigation and actual transitions.
8. The existing full CI gate, leak scan and performance budgets hold. One coordinated check examines the served game after integration. Phone acceptance remains separate.

## Preserve

Clean riding can win ordinary races. Open-field underdog attempts, drift exits, car launches and improvised shortcuts remain available. No lead-erasing teleport/catch-up is introduced. The bridge's real gap and crash rules remain; quiet stretches may provide contrast without prolonged isolation.
