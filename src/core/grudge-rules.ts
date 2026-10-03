// Grudge rules (run W-T, the pitch deck's #14: "grudges with rules"): a grudge match may be played by
// its rival's own rule, a fighting-game boss rule inside a racer. Shared by content/ (the event
// schema's `rules.rule`), sim/ (the rules that change how the rival rides) and the career (the rules
// that change the score), so the list is written once. A contract: a new rule is a small contract PR.

/**
 * The closed list of grudge rules [default; the maintainer can veto each one as content]:
 * - `audit` (Kevin's "The Audit"): win by knockdowns, but every hit the rival lands on you adds a
 *   line item, one more knockdown to the count (capped);
 * - `bad-connection` (Dial-Up's): every few seconds a modem screech warns, the rival freezes for a
 *   second (his connection drops), then reconnects about 15 m further up the road;
 * - `collab` (Chad's "The Collab"): the most style cash at your finish wins, not the place;
 * - `timber` (Old Growth's): only traffic and scenery takedowns count toward the knockdowns.
 * Only `bad-connection` changes the sim; the other three change how the career scores the race.
 */
export const GRUDGE_RULE_IDS = ['audit', 'bad-connection', 'collab', 'timber'] as const;
export type GrudgeRuleId = (typeof GRUDGE_RULE_IDS)[number];
