import { describe, expect, it } from 'vitest';
import {
  freshHeatMemory,
  HEAT_FLASH_MS,
  HEAT_LABELS,
  HEAT_LOST_HOLD_MS,
  HEAT_LOST_LABEL,
  heatBadgeView,
} from './heat-badge';

// The HUD's heat badge (playtest 2, interview 2026-10-02): hidden while clean, filling with the heat,
// a pip per tier, a flash when the tier rises, and "lost 'em" for a few seconds when the cops give up.

describe('the heat badge', () => {
  it('stays hidden while the player is clean, or in a race with no meter', () => {
    const mem = freshHeatMemory();
    expect(heatBadgeView(undefined, 0, mem).visible).toBe(false);
    expect(heatBadgeView({ heat: 0, tier: 0, lost: false }, 0, mem).visible).toBe(false);
  });

  it('fills with the heat and lights a pip per tier, with the tier named', () => {
    const mem = freshHeatMemory();
    const warm = heatBadgeView({ heat: 0.12, tier: 0, lost: false }, 0, mem);
    expect(warm).toMatchObject({ visible: true, fillPct: 12, pips: 0, label: HEAT_LABELS[0] });
    const pair = heatBadgeView({ heat: 0.55, tier: 2, lost: false }, 100, mem);
    expect(pair).toMatchObject({ visible: true, fillPct: 55, pips: 2, label: 'PURSUIT' });
    // Out-of-range values clamp.
    const top = heatBadgeView({ heat: 7, tier: 9, lost: false }, 200, mem);
    expect(top).toMatchObject({ fillPct: 100, pips: 3, label: 'ROADBLOCK' });
    expect(heatBadgeView({ heat: Number.NaN, tier: 0, lost: false }, 300, freshHeatMemory()).visible).toBe(
      false,
    );
  });

  it('flashes when the tier rises, not when it holds or falls', () => {
    const mem = freshHeatMemory();
    expect(heatBadgeView({ heat: 0.2, tier: 0, lost: false }, 0, mem).flash).toBe(false);
    expect(heatBadgeView({ heat: 0.3, tier: 1, lost: false }, 1000, mem).flash).toBe(true);
    expect(heatBadgeView({ heat: 0.3, tier: 1, lost: false }, 1000 + HEAT_FLASH_MS - 1, mem).flash).toBe(
      true,
    );
    expect(heatBadgeView({ heat: 0.3, tier: 1, lost: false }, 1000 + HEAT_FLASH_MS, mem).flash).toBe(false);
    expect(heatBadgeView({ heat: 0.1, tier: 0, lost: false }, 5000, mem).flash).toBe(false);
  });

  it("says lost 'em when the cops give up, for a few seconds, then goes", () => {
    const mem = freshHeatMemory();
    heatBadgeView({ heat: 0.4, tier: 1, lost: false }, 0, mem);
    const lost = heatBadgeView({ heat: 0, tier: 0, lost: true }, 10_000, mem);
    expect(lost).toMatchObject({ visible: true, lost: true, label: HEAT_LOST_LABEL });
    expect(heatBadgeView({ heat: 0, tier: 0, lost: true }, 10_000 + HEAT_LOST_HOLD_MS - 1, mem).visible).toBe(
      true,
    );
    expect(heatBadgeView({ heat: 0, tier: 0, lost: true }, 10_000 + HEAT_LOST_HOLD_MS, mem).visible).toBe(
      false,
    );
    // Heat rising again clears it; a later loss shows the word afresh.
    expect(heatBadgeView({ heat: 0.1, tier: 0, lost: false }, 20_000, mem).lost).toBe(false);
    expect(heatBadgeView({ heat: 0, tier: 0, lost: true }, 30_000, mem).lost).toBe(true);
  });
});
