// Reduce motion in the picture (M5's a11y-1; playtest 4 run B, B13): the flashes. A hit's white wash
// on the body, the cool slow-motion tint, the speed lines, the cops' light bar (red and blue at 4 Hz,
// more than the 3 flashes a second that guidance asks pages to stay under) and the flares' flicker all
// soften or stop when the setting is on. Presentation only: none of it reaches the sim.
import { Group, Mesh, PerspectiveCamera } from 'three';
import { describe, expect, it } from 'vitest';
import type { EntitySnapshot, SimEvent, SimSnapshot } from '../sim/api';
import { lightBarPhase, propFlicker } from './calm';
import { FeelEffects } from './effects';
import { createFlatLook } from './look';
import { SpeedLines } from './speed-lines';
import { defaultRenderParams, type RenderParams } from './tuning';
import { EntityViews } from './views';

function rider(id: number, over: Partial<EntitySnapshot> = {}): EntitySnapshot {
  return {
    id,
    kind: 'rider',
    mode: 'Road',
    road: { edge: 0, s: 100, d: 0, h: 0, dir: 1, yaw: 0 },
    x: id * 2,
    y: 1,
    z: -100,
    heading: 0,
    speed: 25,
    lean: 0,
    contentId: `base:r${id}`,
    name: `r${id}`,
    faction: 'rider',
    slot: id === 0 ? 0 : -1,
    throttle: 0,
    rpm: 0,
    gear: 1,
    grounded: true,
    health: 100,
    healthMax: 100,
    attackPhase: 'idle',
    heldWeapon: null,
    targetId: -1,
    lastAttackerId: -1,
    progress: 0,
    distanceToFinish: 1000,
    place: 1,
    finished: false,
    ...over,
  };
}

function snap(entities: EntitySnapshot[], over: Partial<SimSnapshot> = {}): SimSnapshot {
  return {
    tick: 1,
    timeScale: 1,
    entities,
    race: { over: false, routeLength: 1000, finishOrder: [] },
    ...over,
  };
}

const hit = (actor: number, target: number): SimEvent => ({ tick: 1, type: 'hit', actor, target, data: {} });

function rig(over: Partial<RenderParams> = {}) {
  const look = createFlatLook();
  const params = { ...defaultRenderParams(), ...over };
  const fx = new FeelEffects(look, params);
  const views = new EntityViews(look, { effects: fx, params });
  return { look, params, fx, views };
}

/** Whether the second rider's body is drawn in the flash material 20 ms after a hit on it. */
function flashedAfterHit(over: Partial<RenderParams>, event: SimEvent = hit(0, 1)): boolean {
  const { look, views } = rig(over);
  const s = snap([rider(0), rider(1, { x: 1.2 })]);
  views.sync(null, s, 1, 0);
  views.pushEvents([event]);
  views.sync(s, s, 1, 0.02);
  const groups = views.root.children.filter(
    (c): c is Group => c instanceof Group && c.visible && c.children.length === 5,
  );
  const target = groups[1]?.children[0] as Mesh;
  return target.material === look.material('flash', { vertexColors: true });
}

describe('reduce motion: no white hit flash', () => {
  it('washes the target white by default and not at all under reduce motion', () => {
    expect(flashedAfterHit({})).toBe(true);
    expect(flashedAfterHit({ reduceMotion: true })).toBe(false);
  });

  it('spares a takedown victim the longer flash too', () => {
    const takedown: SimEvent = { tick: 1, type: 'takedown', actor: 0, target: 1, data: {} };
    expect(flashedAfterHit({}, takedown)).toBe(true);
    expect(flashedAfterHit({ reduceMotion: true }, takedown)).toBe(false);
  });

  it('keeps the spark burst and the wobble: the hit still reads', () => {
    const { fx, views } = rig({ reduceMotion: true });
    const s = snap([rider(0), rider(1, { x: 1.2 })]);
    views.sync(null, s, 1, 0);
    views.pushEvents([hit(0, 1)]);
    views.sync(s, s, 1, 0.02);
    expect(fx.counts().sparks).toBeGreaterThan(0);
  });
});

describe('reduce motion: a gentler tint and fainter speed lines', () => {
  const tintAfter = (over: Partial<RenderParams>) => {
    const { fx, views } = rig(over);
    const slow = snap([rider(0)], { timeScale: 0.3, slowmo: { active: true, remainingTicks: 30 } });
    views.sync(null, slow, 1, 0);
    let t = 0;
    for (let i = 0; i < 30; i++) {
      t += 1 / 60;
      views.sync(slow, slow, 1, t);
    }
    return fx.counts().tint;
  };

  it('halves the slow-motion tint', () => {
    const full = tintAfter({});
    expect(full).toBeGreaterThan(0.1);
    expect(tintAfter({ reduceMotion: true })).toBeCloseTo(full / 2, 5);
  });

  const levelAt = (over: Partial<RenderParams>) => {
    const p = { ...defaultRenderParams(), ...over };
    const lines = new SpeedLines(createFlatLook(), p);
    const cam = new PerspectiveCamera(66, 2, 0.3, 1500);
    cam.updateMatrixWorld(true);
    for (let i = 0; i < 240; i++) lines.update(45, 1 / 60, cam);
    return lines.counts().level;
  };

  it('halves the speed lines at top speed', () => {
    const full = levelAt({});
    expect(full).toBeGreaterThan(0.1);
    expect(levelAt({ reduceMotion: true })).toBeCloseTo(full / 2, 5);
  });
});

describe('reduce motion: the flashing lights', () => {
  /** Red-and-blue cycles per second, counted over two seconds of 60 fps frames. */
  const cycles = (calm: boolean) => {
    let n = 0;
    let last = lightBarPhase(0, calm);
    for (let i = 1; i <= 120; i++) {
      const p = lightBarPhase(i / 60, calm);
      if (p !== last) n++;
      last = p;
    }
    return n / 4;
  };

  it('alternates the cops light bar at 4 Hz by default and at 1 Hz under reduce motion', () => {
    expect(cycles(false)).toBeGreaterThanOrEqual(3.5);
    expect(cycles(true)).toBeLessThanOrEqual(1.5);
    // Under the 3 flashes a second that accessibility guidance asks pages to stay below.
    expect(cycles(true)).toBeLessThan(3);
  });

  it('shows both colours either way (it is still the law)', () => {
    for (const calm of [false, true]) {
      const seen = new Set<number>();
      for (let i = 0; i < 240; i++) seen.add(lightBarPhase(i / 60, calm));
      expect(seen.size).toBe(2);
    }
  });

  it('draws the event light bar and flare glow at a steady size under reduce motion', () => {
    const sizes = (kind: 'lightbar' | 'flareGlow', calm: boolean) => {
      const out = new Set<number>();
      for (let i = 0; i < 240; i++) out.add(Math.round(propFlicker(kind, i / 60, 3, calm) * 1000));
      return out;
    };
    expect(sizes('lightbar', false).size).toBeGreaterThan(1);
    expect(sizes('flareGlow', false).size).toBeGreaterThan(1);
    expect(sizes('lightbar', true).size).toBe(1);
    expect(sizes('flareGlow', true).size).toBe(1);
  });
});
