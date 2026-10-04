import { describe, expect, it } from 'vitest';
import { pickStampSpot, STAMP_CLEARANCE } from './stamp';

const box = (left: number, top: number, right: number, bottom: number) => ({ left, top, right, bottom });
// A 568x320 screen: the stamp's two corners, 200x17 each.
const LEFT = box(8, 295, 208, 312);
const RIGHT = box(360, 295, 560, 312);

describe('pickStampSpot', () => {
  it('keeps the left corner when no control is near it', () => {
    expect(pickStampSpot({ left: LEFT, right: RIGHT }, [box(250, 100, 330, 150)])).toBe('left');
    expect(pickStampSpot({ left: LEFT, right: RIGHT }, [])).toBe('left');
  });

  it('moves to the right corner when a control is under the left one', () => {
    expect(pickStampSpot({ left: LEFT, right: RIGHT }, [box(100, 280, 200, 330)])).toBe('right');
  });

  it('hides when a control is under each corner', () => {
    const controls = [box(100, 280, 200, 330), box(400, 290, 500, 330)];
    expect(pickStampSpot({ left: LEFT, right: RIGHT }, controls)).toBe('hidden');
  });

  it('treats a control within the clearance as covered, and one just beyond it as clear', () => {
    const near = box(100, 200, 200, 295 - STAMP_CLEARANCE + 0.5);
    expect(pickStampSpot({ left: LEFT, right: RIGHT }, [near])).toBe('right');
    const far = box(100, 200, 200, 295 - STAMP_CLEARANCE - 1);
    expect(pickStampSpot({ left: LEFT, right: RIGHT }, [far])).toBe('left');
  });

  it('ignores a control with no size (it is not painted)', () => {
    expect(pickStampSpot({ left: LEFT, right: RIGHT }, [box(100, 300, 100, 300)])).toBe('left');
  });
});
