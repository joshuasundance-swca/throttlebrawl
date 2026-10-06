// The structures' parts are the committed models' drawn shapes (the physical world, the maintainer,
// 2026-10-06: "everything a rider can reach is physical at its drawn shape"). scripts/hitboxes.test.ts's twin:
// it holds each model's whole box (road/structures.ts `STRUCTURE_MODELS`) to its file; this holds the parts a
// plan stands for it (Old Town's, road/structures/oldtown.ts `OLDTOWN_PARTS`) to the drawn surface. Every point
// of the drawing lies in some part (within PART_TOLERANCE_M: nothing drawn stands outside the solids, so no
// rider passes through a wall or a post), and every face of every part is touched by the drawing inside it
// (within PART_SLACK_M: no part is bigger than what it stands for). Negative controls move and grow a part.
import { describe, expect, it } from 'vitest';
import { OLDTOWN_PARTS, type Part } from '../src/road';
import { partSolid } from '../src/road/structures/oldtown';
import { MODEL_ASSETS, type ModelKind } from '../src/render/models';
import { bakeRepoModel } from '../src/render/model-files.test-util';
import { holds, print, surfacePoints, type Solid } from '../src/render/structures.test-util';

/** How far a drawn point may lie outside the parts, m: a hipped roof cut into slices sits this far under it at most. */
const PART_TOLERANCE_M = 0.4;
/** How far a part's face may stand off the drawing inside it, m (the surface is sampled about 0.15 m apart). */
const PART_SLACK_M = 0.3;
/** The surface's sampling step, m. */
const STEP_M = 0.15;

const solidsOf = (parts: readonly Part[]): Solid[] =>
  parts.map((p) => ({ ...partSolid(p, { x: 0, y: 0, z: 0, turn: 0 }), name: p.name }));

async function drawn(id: string) {
  const kinds = new Map(
    Object.entries(MODEL_ASSETS).map(([kind, asset]) => [asset as string, kind as ModelKind]),
  );
  const [asset = '', variant = ''] = id.split('#');
  const kind = kinds.get(asset);
  if (!kind) throw new Error(`${id}: no model kind loads ${asset}`);
  const model = await bakeRepoModel(kind);
  const g = model.variants[Number(variant)];
  if (!g) throw new Error(`${id}: ${kind} has no variant ${variant}`);
  return surfacePoints(g, STEP_M);
}

describe("Old Town's parts are its models' drawn shapes (road/structures/oldtown.ts OLDTOWN_PARTS)", () => {
  it.each(Object.keys(OLDTOWN_PARTS))(
    '%s',
    async (id) => {
      const parts = OLDTOWN_PARTS[id] ?? [];
      const points = await drawn(id);
      const held = holds(solidsOf(parts), points, PART_TOLERANCE_M, PART_SLACK_M);
      print(
        `[examined] ${id}: ${parts.length} parts against ${points.length} points of its surface; the farthest ` +
          `${held.worst.toFixed(2)} m outside them, ${held.loose.length} over ${PART_TOLERANCE_M} m; ${held.slack.length} slack faces`,
      );
      expect(
        held.loose
          .slice(0, 5)
          .map(([q, m]) => `${q.x.toFixed(2)} ${q.y.toFixed(2)} ${q.z.toFixed(2)}: ${m.toFixed(2)}`),
      ).toEqual([]);
      expect(held.slack.map(([n, f, g]) => `${n} ${f} ${g.toFixed(2)}`)).toEqual([]);
    },
    60_000,
  );

  it('a negative control: a part moved 0.5 m, or grown 0.5 m, is found', async () => {
    const id = 'models/scenery/duval-kit#1';
    const parts = OLDTOWN_PARTS[id] ?? [];
    const points = await drawn(id);
    const moved = parts.map((p) => (p.name === 'body' ? { ...p, x0: p.x0 + 0.5, x1: p.x1 + 0.5 } : p));
    const grown = parts.map((p) => (p.name === 'post-0' ? { ...p, z1: p.z1 + 0.5 } : p));
    const a = holds(solidsOf(moved), points, PART_TOLERANCE_M, PART_SLACK_M);
    const b = holds(solidsOf(grown), points, PART_TOLERANCE_M, PART_SLACK_M);
    expect(a.loose.length + a.slack.length).toBeGreaterThan(0);
    expect(b.slack.map(([n, f]) => `${n} ${f}`)).toContain('post-0 +v');
  }, 60_000);
});
