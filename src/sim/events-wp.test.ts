// The W-P contract (2026-10-01, "fill the world"): the pedestrian reaction event and its kinds, and
// the traffic behaviour flags a traffic type can carry. Render, audio and barks key on these.
import { describe, expect, it } from 'vitest';
import {
  PED_REACT_KINDS,
  type SimEvent,
  type SimEventType,
  type SimTrafficBehaviour,
  type SimTrafficTypeDef,
} from './api';

describe('the W-P sim contract', () => {
  it('lists the pedestrian reactions: a hop back, a fist, a phone, a dog giving chase', () => {
    expect([...PED_REACT_KINDS]).toEqual(['jumpBack', 'fist', 'film', 'chase']);
  });

  it('accepts a pedReact event from a pedestrian at a rider', () => {
    const type = 'pedReact' satisfies SimEventType;
    const ev: SimEvent = { tick: 1, type, actor: 7, target: 0, data: { kind: 'film', ticks: 120 } };
    expect(ev.type).toBe('pedReact');
  });

  it('a traffic type may carry behaviour flags, and needs none', () => {
    const behaviour: SimTrafficBehaviour = {
      laneChanges: false,
      kerb: true,
      weaveM: 0.4,
      convoy: 3,
      strolls: true,
      chases: true,
    };
    const plain: SimTrafficTypeDef = {
      contentId: 'base:car',
      category: 'car',
      lengthM: 4.6,
      widthM: 1.8,
      cruiseMps: 24,
      hazard: 'normal',
    };
    const flagged: SimTrafficTypeDef = { ...plain, contentId: 'base:scooter', behaviour };
    expect(plain.behaviour).toBeUndefined();
    expect(flagged.behaviour?.convoy).toBe(3);
  });
});
