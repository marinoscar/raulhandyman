import sharp from 'sharp';

import { assessQuality, laplacianVariance, QUALITY_THRESHOLDS } from '../../../src/projects/media/quality';
import { enhance } from '../../../src/projects/media/photo-enhance';
import { sceneImage, sceneJpeg } from './fixtures';

/** Runs the same path the job runs: enhance the original, then assess it. */
async function flagsOf(original: Buffer): Promise<string[]> {
  const out = await enhance(original, { warmth: 0.06, saturation: 1.06 });
  return assessQuality({ original, enhanced: out.buffer, enhancedLumaMean: out.stats.lumaMean });
}

describe('quality flags', () => {
  it('flags nothing on a clean fixture', async () => {
    expect(await flagsOf(await sceneJpeg(1600, 1200))).toEqual([]);
  });

  it('too_small: the long edge is under 1200px', async () => {
    expect(await flagsOf(await sceneJpeg(1000, 700))).toContain('too_small');
    expect(await flagsOf(await sceneJpeg(1200, 800))).not.toContain('too_small');
  });

  it('too_dark: the enhanced mean luminance is under 55', async () => {
    // A mostly-black frame: auto-levels cannot lift it above the threshold.
    const dark = await sharp({ create: { width: 1600, height: 1200, channels: 3, background: { r: 6, g: 6, b: 8 } } })
      .composite([{ input: await sharp({ create: { width: 60, height: 60, channels: 3, background: { r: 40, g: 40, b: 44 } } }).png().toBuffer(), left: 700, top: 500 }])
      .jpeg()
      .toBuffer();
    expect(await flagsOf(dark)).toContain('too_dark');
  });

  it('blurry: the Laplacian variance is under the threshold, and only for the blurred copy', async () => {
    const sharpJpeg = await sceneJpeg(1600, 1200);
    const blurred = await sharp(sharpJpeg).blur(14).jpeg().toBuffer();
    const sharpVariance = await laplacianVariance(sharpJpeg);
    const blurredVariance = await laplacianVariance(blurred);
    // The threshold sits between the two fixtures with a wide margin on each side.
    expect(sharpVariance).toBeGreaterThan(QUALITY_THRESHOLDS.minLaplacianVariance * 2);
    expect(blurredVariance).toBeLessThan(QUALITY_THRESHOLDS.minLaplacianVariance / 2);
    expect(await flagsOf(blurred)).toContain('blurry');
    expect(await flagsOf(sharpJpeg)).not.toContain('blurry');
  });

  it('low_contrast: the luminance stdev is under 30', async () => {
    const flat = await sceneImage(1600, 1200, { noise: 3 }).linear(0.12, 108).jpeg().toBuffer();
    const flags = await flagsOf(flat);
    expect(flags).toContain('low_contrast');
    expect(flags).not.toContain('too_dark');
  });
});
