import sharp from 'sharp';

import { enhance, grayWorldGains, warmMatrix } from '../../../src/projects/media/photo-enhance';
import { sceneImage, sceneJpeg, sceneRaw } from './fixtures';

const GRADE = { warmth: 0.06, saturation: 1.06 };
const spread = (means: readonly number[]): number => Math.max(...means) - Math.min(...means);

describe('enhance', () => {
  it('applies the EXIF orientation and strips every kind of metadata (GPS, XMP, ICC)', async () => {
    // Stored landscape 300x200, left half red and right half blue, orientation 6
    // (rotate 90 degrees clockwise to display): upright it is 200x300, red on top.
    const width = 300;
    const height = 200;
    const raw = Buffer.alloc(width * height * 3);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const i = (y * width + x) * 3;
        const left = x < width / 2;
        raw[i] = left ? 200 : 30;
        raw[i + 1] = 90;
        raw[i + 2] = left ? 30 : 200;
      }
    }
    const input = await sharp(raw, { raw: { width, height, channels: 3 } })
      .withIccProfile('p3')
      .withExif({
        IFD0: { Make: 'Camera Maker A' },
        IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '40/1 26/1 46/1', GPSLongitudeRef: 'W', GPSLongitude: '79/1 58/1 56/1' },
      })
      .withMetadata({ orientation: 6 })
      .jpeg()
      .toBuffer();
    const before = await sharp(input).metadata();
    expect(before.orientation).toBe(6);
    expect(before.exif).toBeDefined();
    expect(before.icc).toBeDefined();
    expect(before.exif!.includes(Buffer.from('Camera Maker A'))).toBe(true);

    const out = await enhance(input, GRADE);
    expect([out.width, out.height]).toEqual([200, 300]);
    const meta = await sharp(out.buffer).metadata();
    expect([meta.width, meta.height]).toEqual([200, 300]);
    expect(meta.exif).toBeUndefined();
    expect(meta.xmp).toBeUndefined();
    expect(meta.iptc).toBeUndefined();
    expect(meta.icc).toBeUndefined();
    expect(meta.orientation).toBeUndefined();
    expect(out.buffer.includes(Buffer.from('Camera Maker A'))).toBe(false);
    expect(out.buffer.includes(Buffer.from('Exif'))).toBe(false);

    // Upright: red on top, blue at the bottom.
    const px = async (x: number, y: number): Promise<number[]> => {
      const { data } = await sharp(out.buffer).extract({ left: x, top: y, width: 1, height: 1 }).raw().toBuffer({ resolveWithObject: true });
      return [...data];
    };
    const top = await px(100, 20);
    const bottom = await px(100, 280);
    expect(top[0]).toBeGreaterThan(top[2]);
    expect(bottom[2]).toBeGreaterThan(bottom[0]);
  });

  it('reduces the channel-mean spread of a blue-cast image by at least 50%', async () => {
    const castInput = await sceneImage(600, 400, { cast: [0.78, 0.92, 1.1] }).png().toBuffer();
    const inputMeans = (await sharp(castInput).stats()).channels.slice(0, 3).map((c) => c.mean);
    const out = await enhance(castInput, GRADE);
    expect(spread(inputMeans)).toBeGreaterThan(20);
    expect(spread(out.stats.channelMeans)).toBeLessThanOrEqual(spread(inputMeans) * 0.5);
  });

  it('leaves a neutral image near neutral', async () => {
    const out = await enhance(await sceneJpeg(400, 300), { warmth: 0 });
    expect(spread(out.stats.channelMeans)).toBeLessThan(20);
  });

  it('is deterministic: same input and options give identical bytes', async () => {
    const input = await sceneJpeg(500, 350, { cast: [0.9, 1, 1.05] });
    const a = await enhance(input, GRADE);
    const b = await enhance(input, GRADE);
    expect(a.buffer.equals(b.buffer)).toBe(true);
    expect(a.dominantColor).toBe(b.dominantColor);
  });

  it('a stronger warmth changes the output (the next photo uses the new setting)', async () => {
    const input = await sceneJpeg(300, 200);
    const cool = await enhance(input, { warmth: 0 });
    const warm = await enhance(input, { warmth: 0.2 });
    expect(cool.buffer.equals(warm.buffer)).toBe(false);
    expect(warm.stats.channelMeans[0] - warm.stats.channelMeans[2]).toBeGreaterThan(cool.stats.channelMeans[0] - cool.stats.channelMeans[2] + 10);
  });

  it('fits inside 2400x2400 and never enlarges a small image', async () => {
    const big = await enhance(await sceneJpeg(3200, 1800), GRADE);
    expect([big.width, big.height]).toEqual([2400, 1350]);
    const small = await enhance(await sceneJpeg(320, 240), GRADE);
    expect([small.width, small.height]).toEqual([320, 240]);
  });

  it('reports a #rrggbb dominant colour and luminance statistics', async () => {
    const out = await enhance(await sceneJpeg(300, 200), GRADE);
    expect(out.dominantColor).toMatch(/^#[0-9a-f]{6}$/);
    expect(out.stats.lumaMean).toBeGreaterThan(0);
    expect(out.stats.lumaStdev).toBeGreaterThan(0);
  });

  it('rejects bytes that are not an image', async () => {
    await expect(enhance(Buffer.from('not an image at all'), GRADE)).rejects.toThrow();
  });

  it('clamps the gray-world gains to [0.85, 1.15]', () => {
    const gains = grayWorldGains([40, 100, 200]);
    for (const gain of gains) {
      expect(gain).toBeGreaterThanOrEqual(0.85);
      expect(gain).toBeLessThanOrEqual(1.15);
    }
    expect(grayWorldGains([100, 100, 100])).toEqual([1, 1, 1]);
    expect(warmMatrix(0.06)[0][0]).toBeCloseTo(1.06);
    expect(warmMatrix(0.06)[2][2]).toBeCloseTo(0.94);
  });

  it('keeps the sceneRaw fixture deterministic', () => {
    expect(sceneRaw(16, 16).equals(sceneRaw(16, 16))).toBe(true);
  });
});
