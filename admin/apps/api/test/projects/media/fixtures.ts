// Synthetic image fixtures, generated in the tests: no binary files, no real photos.
import sharp from 'sharp';

/** A small deterministic pseudo-random generator (LCG), so fixtures are identical on every run. */
export function rng(seed = 1): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

export interface SceneOptions {
  /** Per-channel multipliers, to simulate a colour cast. */
  cast?: [number, number, number];
  /** Overall brightness multiplier. */
  brightness?: number;
  /** Amplitude of the texture noise, 0..255. */
  noise?: number;
  seed?: number;
}

/**
 * A photo-like RGB scene: a vertical gradient, a grid of coloured blocks (hard
 * edges) and noise. Returns raw RGB pixels.
 */
export function sceneRaw(width: number, height: number, opts: SceneOptions = {}): Buffer {
  const { cast = [1, 1, 1], brightness = 1, noise = 14, seed = 7 } = opts;
  const rand = rng(seed);
  const data = Buffer.alloc(width * height * 3);
  const block = Math.max(8, Math.round(Math.min(width, height) / 8));
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const cell = (Math.floor(x / block) * 7 + Math.floor(y / block) * 13) % 5;
      const base = 70 + cell * 28 + (y / height) * 40;
      const i = (y * width + x) * 3;
      for (let c = 0; c < 3; c += 1) {
        const tint = c === 0 ? cell * 3 : c === 1 ? 10 - cell * 2 : cell;
        const value = (base + tint + (rand() - 0.5) * noise) * brightness * cast[c];
        data[i + c] = Math.max(0, Math.min(255, Math.round(value)));
      }
    }
  }
  return data;
}

export const sceneImage = (width: number, height: number, opts?: SceneOptions): sharp.Sharp =>
  sharp(sceneRaw(width, height, opts), { raw: { width, height, channels: 3 } });

export const sceneJpeg = (width: number, height: number, opts?: SceneOptions): Promise<Buffer> => sceneImage(width, height, opts).jpeg({ quality: 92 }).toBuffer();

/** A flat dark-grey image with one bright square, in a lightly textured field. Returns the file and the square's centre as fractions. */
export async function squareScene(width: number, height: number, square: { left: number; top: number; size: number }): Promise<{ buffer: Buffer; centre: { x: number; y: number } }> {
  const background = await sceneImage(width, height, { brightness: 0.45, noise: 6, seed: 3 }).png().toBuffer();
  const bright = await sharp({ create: { width: square.size, height: square.size, channels: 3, background: { r: 255, g: 215, b: 0 } } }).png().toBuffer();
  const buffer = await sharp(background).composite([{ input: bright, left: square.left, top: square.top }]).jpeg({ quality: 92 }).toBuffer();
  return { buffer, centre: { x: (square.left + square.size / 2) / width, y: (square.top + square.size / 2) / height } };
}
