import type { Page } from '@playwright/test';

/**
 * Luminance statistics of a PNG screenshot, decoded in the page so no image library is needed.
 * "Not blank" means variance above a threshold: a black, empty or single-colour canvas has ~0.
 */
export async function pixelStats(
  page: Page,
  png: Buffer,
): Promise<{ mean: number; variance: number; pixels: number }> {
  return page.evaluate(async (b64: string) => {
    const img = new Image();
    img.src = `data:image/png;base64,${b64}`;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.width;
    c.height = img.height;
    const ctx = c.getContext('2d');
    if (!ctx) throw new Error('no 2d context');
    ctx.drawImage(img, 0, 0);
    const { data } = ctx.getImageData(0, 0, c.width, c.height);
    let sum = 0;
    let sumSq = 0;
    const n = data.length / 4;
    for (let i = 0; i < data.length; i += 4) {
      const l = 0.299 * (data[i] ?? 0) + 0.587 * (data[i + 1] ?? 0) + 0.114 * (data[i + 2] ?? 0);
      sum += l;
      sumSq += l * l;
    }
    const mean = sum / n;
    return { mean, variance: sumSq / n - mean * mean, pixels: n };
  }, png.toString('base64'));
}

/** Minimum luminance variance for a canvas to count as "not blank". */
export const NOT_BLANK_VARIANCE = 100;
