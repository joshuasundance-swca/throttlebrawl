import { bikePrice, type AskDef, type CareerDef, type CareerNode, type GigDef } from '../career';
import type { ContentRegistry } from '../content';
import type { ReplayHeader } from '../replay';
import type { Profile } from '../save';
import type { CareerFlow, CareerRaceSetup } from './career-flow';
import { canonicalJson, profileFromGuard, type SavedRaceContext } from './saved-race';

export interface RecoveryCareer {
  def: CareerDef;
  node: CareerNode;
  setup: CareerRaceSetup;
  starting: Profile;
  ask: AskDef | null;
  gig: GigDef | null;
  bike: string;
  key: string;
}

/** Identity of actual career rules and settlement inputs, separate from sim compatibility. */
export function recoveryCareer(
  flow: CareerFlow,
  reg: ContentRegistry,
  defs: readonly CareerDef[],
  context: Omit<Extract<SavedRaceContext, { kind: 'career' }>, 'contextKey'>,
  header: ReplayHeader,
): RecoveryCareer {
  const def = defs.find((d) => d.key === context.careerKey);
  const node = def?.nodes.find((n) => n.id === context.nodeId);
  const starting = profileFromGuard(context.profileGuard);
  const bike = header.config?.riders.find((r) => r.controller.kind === 'player')?.bike.contentId;
  if (
    !def ||
    !node ||
    !starting ||
    !bike ||
    def.regionId !== context.regionId ||
    node.event !== context.eventId ||
    context.eventId !== header.eventId
  )
    throw new Error('Saved career context is unavailable');
  const setup = flow.careerRaceSetup(reg, defs, starting, def, node);
  const show = flow.raceShow(reg, def, setup.plan, starting, header.seed);
  const ask = starting.history.length > 0 ? show.ask : null;
  const key = canonicalJson({
    def,
    node,
    setup,
    length: context.length,
    ask,
    gig: show.gig,
    ridden: { bike, price: bikePrice(reg, def, bike) },
    grants: def.unlocks.map((u) => ({ grant: u.grant, available: !!reg.bikes[u.grant] })),
  });
  return { def, node, setup, starting, ask, gig: show.gig, bike, key };
}
