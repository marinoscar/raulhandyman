import sharp from 'sharp';

/** Longest edge of the enhanced master. */
export const MASTER_MAX_EDGE = 2400;

export interface GradeOptions {
  /** Warm grade toward the site's gold, 0..0.3. Default 0.06 (setting `projects.grade.warmth`). */
  warmth: number;
  /** Saturation multiplier. Default 1.06 (setting `projects.grade.saturation`). */
  saturation?: number;
}

export interface EnhanceStats {
  /** Mean of each channel of the enhanced master, 0..255. */
  channelMeans: [number, number, number];
  /** Mean and standard deviation of the luminance, 0..255. */
  lumaMean: number;
  lumaStdev: number;
}

export interface EnhanceResult {
  /** The enhanced master: JPEG, sRGB, no metadata. */
  buffer: Buffer;
  width: number;
  height: number;
  /** `#rrggbb` of the dominant colour, for the site's placeholder backgrounds. */
  dominantColor: string;
  stats: EnhanceStats;
}

interface Raw {
  data: Buffer;
  width: number;
  height: number;
}

const GAIN_MIN = 0.85;
const GAIN_MAX = 1.15;
const CONTRAST = 1.04;

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

async function toRaw(pipeline: sharp.Sharp): Promise<Raw> {
  const { data, info } = await pipeline.raw().toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

const fromRaw = (raw: Raw): sharp.Sharp => sharp(raw.data, { raw: { width: raw.width, height: raw.height, channels: 3 } });

/** Per-channel gains of the clamped gray-world white balance, from the channel means. */
export function grayWorldGains(means: readonly number[]): [number, number, number] {
  const [r, g, b] = means;
  const mean = (r + g + b) / 3;
  const gain = (channel: number): number => (channel > 0 ? clamp(mean / channel, GAIN_MIN, GAIN_MAX) : 1);
  return [gain(r), gain(g), gain(b)];
}

/** The 3x3 warm matrix: lifts red and lowers blue by `warmth`. */
export function warmMatrix(warmth: number): [[number, number, number], [number, number, number], [number, number, number]] {
  return [
    [1 + warmth, 0, 0],
    [0, 1, 0],
    [0, 0, 1 - warmth],
  ];
}

const hex = (value: number): string => clamp(Math.round(value), 0, 255).toString(16).padStart(2, '0');

/**
 * The enhance pipeline: orient, strip metadata, fit inside 2400x2400, auto-level,
 * clamped gray-world white balance, gentle contrast and saturation, a warm grade
 * toward the site's gold, sharpen, then a mozjpeg master.
 *
 * Pure of the database and storage: Buffer in, Buffer and measurements out. Each
 * stage materialises its pixels before the next, because sharp applies its
 * operations in a fixed internal order, not the order they are written in.
 * Never calls `withMetadata`/`keepExif`: EXIF (GPS included), XMP and any input
 * ICC profile are dropped, and the pixels are converted to sRGB.
 */
export async function enhance(input: Buffer, opts: GradeOptions): Promise<EnhanceResult> {
  const warmth = clamp(opts.warmth, 0, 0.3);
  const saturation = opts.saturation ?? 1.06;

  // 1-3. Orient (EXIF orientation), fit inside 2400x2400, auto-levels, sRGB.
  const leveled = await toRaw(
    sharp(input, { failOn: 'error' })
      .rotate()
      .resize(MASTER_MAX_EDGE, MASTER_MAX_EDGE, { fit: 'inside', withoutEnlargement: true })
      .flatten({ background: '#ffffff' })
      .toColourspace('srgb')
      .removeAlpha()
      .normalise({ lower: 1, upper: 99 }),
  );

  // 4-5. Gray-world white balance and the contrast curve, as one linear map:
  // out = (x * gain) * 1.04 - 128 * 0.04.
  const stats = await fromRaw(leveled).stats();
  const gains = grayWorldGains(stats.channels.slice(0, 3).map((channel) => channel.mean));
  const balanced = await toRaw(fromRaw(leveled).linear(gains.map((gain) => gain * CONTRAST), [-(128 * 0.04), -(128 * 0.04), -(128 * 0.04)]));

  // 5-6. Saturation and the warm grade.
  const graded = await toRaw(fromRaw(balanced).recomb(warmMatrix(warmth)).modulate({ saturation }));

  // 7-9. Sharpen and encode. `toColourspace('srgb')` tags the output sRGB;
  // nothing else is written (no EXIF, XMP or GPS).
  const buffer = await fromRaw(graded)
    .sharpen({ sigma: 0.8 })
    .toColourspace('srgb')
    .jpeg({ quality: 85, mozjpeg: true, chromaSubsampling: '4:2:0' })
    .toBuffer();

  // 10. Measurements of what was written.
  const final = await sharp(buffer).stats();
  // `stats()` reads its input, not the pipeline: materialise the greyscale first.
  const grey = await toRaw(sharp(buffer).greyscale());
  const luma = await sharp(grey.data, { raw: { width: grey.width, height: grey.height, channels: 1 } }).stats();
  const { r, g, b } = final.dominant;
  return {
    buffer,
    width: graded.width,
    height: graded.height,
    dominantColor: `#${hex(r)}${hex(g)}${hex(b)}`,
    stats: {
      channelMeans: [final.channels[0].mean, final.channels[1].mean, final.channels[2].mean],
      lumaMean: luma.channels[0].mean,
      lumaStdev: luma.channels[0].stdev,
    },
  };
}
