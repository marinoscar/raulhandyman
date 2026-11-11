import sharp from 'sharp';

import { CROP_SPECS, cropWindow, findFocalPoint, makeCrops } from '../../../src/projects/media/photo-crops';
import { sceneJpeg, squareScene } from './fixtures';

const SIZES = { card4x3: [1600, 1200], hero16x9: [2400, 1350], thumb: [480, 360], og: [1200, 630] } as const;

/** The number of near-gold pixels in an image. */
async function goldPixels(buffer: Buffer): Promise<number> {
  const { data } = await sharp(buffer).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  let count = 0;
  for (let i = 0; i < data.length; i += 3) if (data[i] > 200 && data[i + 1] > 160 && data[i + 2] < 90) count += 1;
  return count;
}

describe('smart crops', () => {
  const SQUARE = { left: 2150, top: 350, size: 300 };

  it('puts the focal point within 10% of an off-centre bright square, and every crop contains it', async () => {
    const { buffer, centre } = await squareScene(3000, 2000, SQUARE);
    const focal = await findFocalPoint(buffer);
    expect(Math.abs(focal.x - centre.x)).toBeLessThan(0.1);
    expect(Math.abs(focal.y - centre.y)).toBeLessThan(0.1);

    const crops = await makeCrops(buffer, focal, ['card4x3', 'hero16x9', 'thumb', 'og']);
    for (const crop of crops) {
      // The square covers 300x300 source px; each crop is scaled by out/window, so
      // nearly all of its area must survive inside the crop.
      const window = cropWindow(3000, 2000, crop.width, crop.height, focal);
      const scale = crop.width / window.width;
      const expected = SQUARE.size * SQUARE.size * scale * scale;
      expect(await goldPixels(crop.buffer)).toBeGreaterThan(expected * 0.9);
    }
  });

  it('produces the exact sizes and formats, with no rendition above its source', async () => {
    const source = await sceneJpeg(3000, 2000);
    const crops = await makeCrops(source, { x: 0.5, y: 0.5 });
    expect(crops.map((crop) => crop.key)).toEqual(['card4x3', 'hero16x9', 'thumb', 'og', 'ai1024']);
    for (const crop of crops) {
      const meta = await sharp(crop.buffer).metadata();
      expect([meta.width, meta.height]).toEqual([crop.width, crop.height]);
      if (crop.key !== 'ai1024') expect([crop.width, crop.height]).toEqual(SIZES[crop.key]);
      expect(meta.format).toBe(crop.key === 'thumb' ? 'webp' : 'jpeg');
      expect(meta.exif).toBeUndefined();
    }
    const ai = crops.find((crop) => crop.key === 'ai1024')!;
    expect(Math.max(ai.width, ai.height)).toBe(1024);
    expect(ai.width / ai.height).toBeCloseTo(1.5, 1);
  });

  it('never upscales: a small source yields the largest crop of the right ratio', async () => {
    const small = await sceneJpeg(800, 700);
    const crops = await makeCrops(small, { x: 0.5, y: 0.5 });
    for (const crop of crops) {
      expect(crop.width).toBeLessThanOrEqual(800);
      expect(crop.height).toBeLessThanOrEqual(700);
      if (crop.key === 'ai1024') {
        expect([crop.width, crop.height]).toEqual([800, 700]);
        continue;
      }
      const [tw, th] = SIZES[crop.key];
      expect(crop.width / crop.height).toBeCloseTo(tw / th, 1);
      expect(crop.width).toBeLessThanOrEqual(tw);
      expect(crop.height).toBeLessThanOrEqual(th);
    }
    const card = crops.find((crop) => crop.key === 'card4x3')!;
    expect([card.width, card.height]).toEqual([800, 600]);
  });

  it('clamps the window to the image bounds for a focal point at a corner', () => {
    const window = cropWindow(3000, 2000, 1600, 1200, { x: 1, y: 1 });
    expect(window.left + window.width).toBeLessThanOrEqual(3000);
    expect(window.top + window.height).toBeLessThanOrEqual(2000);
    expect(window.left).toBeGreaterThanOrEqual(0);
    const topLeft = cropWindow(3000, 2000, 1200, 630, { x: 0, y: 0 });
    expect([topLeft.left, topLeft.top]).toEqual([0, 0]);
  });

  it('declares the four frames', () => {
    expect(CROP_SPECS.map((spec) => spec.key)).toEqual(['card4x3', 'hero16x9', 'thumb', 'og']);
  });
});
