// One pure oracle shared by fixture checks and the complete same-process reporter.
export interface LandingTally {
  landings: number;
  clean: number;
  wobble: number;
  crashOnLanding: number;
  crashAfter: number;
  airCrash: number;
  causes: Record<string, number>;
}
export interface LandingResult {
  player: LandingTally;
  rivals: LandingTally;
}
export const tally = (): LandingTally => ({
  landings: 0,
  clean: 0,
  wobble: 0,
  crashOnLanding: 0,
  crashAfter: 0,
  airCrash: 0,
  causes: {},
});
export function validateTally(t: LandingTally): void {
  const counts = t && [t.landings, t.clean, t.wobble, t.crashOnLanding, t.crashAfter, t.airCrash];
  if (
    !counts ||
    !counts.every((n) => Number.isSafeInteger(n) && n >= 0) ||
    t.landings !== t.clean + t.wobble + t.crashOnLanding ||
    !t.causes ||
    typeof t.causes !== 'object' ||
    Array.isArray(t.causes) ||
    !Object.values(t.causes).every((n) => Number.isSafeInteger(n) && n >= 0)
  )
    throw new Error('Malformed landing survey tally');
}
function add(total: LandingTally, t: LandingTally): void {
  total.landings += t.landings;
  total.clean += t.clean;
  total.wobble += t.wobble;
  total.crashOnLanding += t.crashOnLanding;
  total.crashAfter += t.crashAfter;
  total.airCrash += t.airCrash;
  for (const [cause, n] of Object.entries(t.causes)) total.causes[cause] = (total.causes[cause] ?? 0) + n;
}
export function foldLandings(cases: readonly { thumb: boolean }[], rows: readonly LandingResult[]) {
  if (cases.length === 0 || rows.length !== cases.length)
    throw new Error('Missing complete landing survey results');
  const bot = tally(),
    thumb = tally(),
    rivals = tally();
  rows.forEach((r, i) => {
    if (!r) throw new Error('Missing landing survey result');
    validateTally(r.player);
    validateTally(r.rivals);
    if (cases[i]!.thumb) add(thumb, r.player);
    else {
      add(bot, r.player);
      add(rivals, r.rivals);
    }
  });
  return { bot, thumb, rivals };
}
export function assertLandings({ bot, thumb, rivals }: ReturnType<typeof foldLandings>): void {
  if (bot.landings + thumb.landings <= 0) throw new Error('Landing survey needs global player exposure');
  for (const [name, t] of [
    ['bot', bot],
    ['thumb', thumb],
  ] as const)
    if (t.crashOnLanding + t.crashAfter !== 0)
      throw new Error(`Landing survey ${name} landing/post-wobble crash`);
  if (rivals.crashOnLanding > Math.floor(rivals.landings / 10))
    throw new Error('Landing survey rival pooled crash ceiling exceeded');
}
export const landingLine = (name: string, t: LandingTally) => {
  const bad = t.crashOnLanding + t.crashAfter + t.airCrash;
  const pct = t.landings > 0 ? ((100 * bad) / t.landings).toFixed(1) : '0';
  return `${name}: ${t.landings} landings, ${t.clean} clean, ${t.wobble} wobble, ${t.crashOnLanding} crash on landing, ${t.crashAfter} crash within 1 s after, ${t.airCrash} crash in the air: ${pct}% bad; causes ${JSON.stringify(t.causes)}`;
};
