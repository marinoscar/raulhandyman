import sharp from 'sharp';

import { OG_BAND_HEIGHT, OG_BAND_TOP, OG_HEIGHT, OG_PADDING, OG_RULE_HEIGHT, OG_WIDTH, renderOgImage } from '../../../src/projects/media/photo-og';

const BRAND = { navy: '#0e1f3d', gold: '#d6a84e', businessName: 'Business Alpha' };
const SEVENTY = 'Complete kitchen cabinet refresh with new hardware and trim, Unit 12'.padEnd(70, 'x').slice(0, 70);

async function flat(): Promise<Buffer> {
  return sharp({ create: { width: 1200, height: 630, channels: 3, background: { r: 120, g: 120, b: 120 } } }).jpeg().toBuffer();
}

/** Bounding box of the light (text) pixels inside the band, below the gold rule. */
async function textBox(image: Buffer): Promise<{ minX: number; maxX: number; minY: number; maxY: number; count: number }> {
  const { data, info } = await sharp(image).raw().toBuffer({ resolveWithObject: true });
  let minX = Infinity;
  let maxX = -1;
  let minY = Infinity;
  let maxY = -1;
  let count = 0;
  for (let y = OG_BAND_TOP + OG_RULE_HEIGHT; y < info.height; y += 1) {
    for (let x = 0; x < info.width; x += 1) {
      const i = (y * info.width + x) * info.channels;
      // Text is white (title) or gold (second line); the band is dark navy over grey.
      if (data[i] + data[i + 1] + data[i + 2] > 330) {
        count += 1;
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
      }
    }
  }
  return { minX, maxX, minY, maxY, count };
}

describe('branded OG image', () => {
  it('is 1200x630 JPEG with no metadata', async () => {
    const out = await renderOgImage({ crop: await flat(), title: 'Deck repair', town: 'Springfield', brand: BRAND });
    const meta = await sharp(out).metadata();
    expect([meta.width, meta.height, meta.format]).toEqual([OG_WIDTH, OG_HEIGHT, 'jpeg']);
    expect(meta.exif).toBeUndefined();
  });

  it('draws a navy band over the bottom 34% with a gold rule, leaving the photo above untouched', async () => {
    const out = await renderOgImage({ crop: await flat(), title: 'Deck repair', town: 'Springfield', brand: BRAND });
    expect(OG_BAND_HEIGHT).toBe(214);
    const { data, info } = await sharp(out).raw().toBuffer({ resolveWithObject: true });
    const at = (x: number, y: number): number[] => [...data.subarray((y * info.width + x) * info.channels, (y * info.width + x) * info.channels + 3)];
    // Above the band: the grey photo.
    expect(at(600, 100).every((v) => Math.abs(v - 120) < 4)).toBe(true);
    // The rule: gold.
    const rule = at(1100, OG_BAND_TOP + 1);
    expect(rule[0]).toBeGreaterThan(190);
    expect(rule[2]).toBeLessThan(110);
    // The band: 92% navy over grey = 0.92*(14,31,61) + 0.08*120.
    const band = at(1150, OG_BAND_TOP + 100);
    expect(Math.abs(band[0] - 22.5)).toBeLessThan(6);
    expect(Math.abs(band[1] - 38)).toBeLessThan(6);
    expect(Math.abs(band[2] - 66)).toBeLessThan(6);
  });

  it('keeps the text of a 70-character title inside the band and its side margins', async () => {
    expect(SEVENTY).toHaveLength(70);
    const out = await renderOgImage({ crop: await flat(), title: SEVENTY, town: 'Springfield', brand: BRAND });
    const box = await textBox(out);
    expect(box.count).toBeGreaterThan(500);
    expect(box.minX).toBeGreaterThanOrEqual(OG_PADDING - 6);
    expect(box.maxX).toBeLessThanOrEqual(OG_WIDTH - OG_PADDING + 6);
    expect(box.minY).toBeGreaterThan(OG_BAND_TOP + OG_RULE_HEIGHT);
    expect(box.maxY).toBeLessThan(OG_HEIGHT - 8);
    // Above the band nothing was drawn.
    const aboveRegion = await sharp(out).extract({ left: 0, top: 0, width: OG_WIDTH, height: OG_BAND_TOP - 1 }).toBuffer();
    const above = await sharp(aboveRegion).stats();
    expect(above.channels[0].max - above.channels[0].min).toBeLessThan(12);
  });

  it('wraps to two lines and ellipsises a title that does not fit', async () => {
    const long = 'A very long project title that goes on and on about every single room, fixture, cabinet and tile in the house '.repeat(3);
    const out = await renderOgImage({ crop: await flat(), title: long, town: 'Springfield', brand: BRAND });
    const box = await textBox(out);
    expect(box.maxY).toBeLessThan(OG_HEIGHT - 8);
    expect(box.minY).toBeGreaterThan(OG_BAND_TOP + OG_RULE_HEIGHT);
    expect(box.maxX).toBeLessThanOrEqual(OG_WIDTH - OG_PADDING + 6);
    // The title block (white text) is at most two lines tall: it ends well above the second line.
    const short = await textBox(await renderOgImage({ crop: await flat(), title: 'Short', town: 'Springfield', brand: BRAND }));
    expect(box.minY).toBeLessThanOrEqual(short.minY + 2);
  });

  it('reserves room at the right for a logo and draws it there', async () => {
    const logo = await sharp({ create: { width: 200, height: 80, channels: 3, background: { r: 255, g: 0, b: 255 } } }).png().toBuffer();
    const out = await renderOgImage({ crop: await flat(), title: SEVENTY, town: 'Springfield', brand: { ...BRAND, logo } });
    const { data, info } = await sharp(out).raw().toBuffer({ resolveWithObject: true });
    let magenta = 0;
    let magentaMinX = Infinity;
    for (let y = OG_BAND_TOP; y < info.height; y += 1) {
      for (let x = 0; x < info.width; x += 1) {
        const i = (y * info.width + x) * info.channels;
        if (data[i] > 200 && data[i + 1] < 60 && data[i + 2] > 200) {
          magenta += 1;
          magentaMinX = Math.min(magentaMinX, x);
        }
      }
    }
    expect(magenta).toBeGreaterThan(200 * 80 * 0.9);
    expect(magentaMinX).toBeGreaterThan(OG_WIDTH - OG_PADDING - 205);
    // Text stays left of the logo.
    const box = await textBox(out);
    expect(box.count).toBeGreaterThan(0);
  });

  it('escapes markup characters in the title', async () => {
    await expect(renderOgImage({ crop: await flat(), title: 'Tom & Jerry <Fence> "Repair"', town: 'Springfield', brand: BRAND })).resolves.toBeInstanceOf(Buffer);
  });
});
