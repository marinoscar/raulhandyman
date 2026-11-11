import sharp from 'sharp';

export type QualityFlag = 'too_small' | 'too_dark' | 'blurry' | 'low_contrast';

export const QUALITY_THRESHOLDS = {
  /** Long edge of the original, px. */
  minLongEdge: 1200,
  /** Mean luminance of the enhanced master, 0..255. */
  minLumaMean: 55,
  /** Luminance standard deviation of the ORIGINAL (auto-levels would stretch a flat photo, hiding it). */
  minLumaStdev: 30,
  /** Variance of the Laplacian on a 512px greyscale proxy. Calibrated on generated sharp and blurred fixtures (quality.spec.ts). */
  minLaplacianVariance: 60,
} as const;

const PROXY_EDGE = 512;
const LAPLACIAN = [0, 1, 0, 1, -4, 1, 0, 1, 0];

/** Variance of the 3x3 Laplacian of a 512px greyscale proxy: low means few edges, i.e. blurry. */
export async function laplacianVariance(image: Buffer): Promise<number> {
  const { data } = await sharp(image)
    .resize(PROXY_EDGE, PROXY_EDGE, { fit: 'inside', withoutEnlargement: true })
    .greyscale()
    .convolve({ width: 3, height: 3, kernel: LAPLACIAN, scale: 1, offset: 128 })
    .raw()
    .toBuffer({ resolveWithObject: true });
  let sum = 0;
  let sumSquares = 0;
  for (const byte of data) {
    const value = byte - 128;
    sum += value;
    sumSquares += value * value;
  }
  const mean = sum / data.length;
  return sumSquares / data.length - mean * mean;
}

/** Standard deviation of the luminance of a 512px greyscale proxy (`stats()` reads its input, so the proxy is materialised first). */
export async function lumaStdev(image: Buffer): Promise<number> {
  const { data, info } = await sharp(image)
    .resize(PROXY_EDGE, PROXY_EDGE, { fit: 'inside', withoutEnlargement: true })
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const stats = await sharp(data, { raw: { width: info.width, height: info.height, channels: 1 } }).stats();
  return stats.channels[0].stdev;
}

export interface QualityInput {
  /** The original file, for its pixel size and its contrast (auto-levels would hide a flat photo). */
  original: Buffer;
  /** The enhanced master, for the blur measure. */
  enhanced: Buffer;
  /** The enhanced master's mean luminance. */
  enhancedLumaMean: number;
}

/** The quality flags of a photo, in a stable order. */
export async function assessQuality(input: QualityInput): Promise<QualityFlag[]> {
  const meta = await sharp(input.original).metadata();
  const flags: QualityFlag[] = [];
  if (Math.max(meta.width ?? 0, meta.height ?? 0) < QUALITY_THRESHOLDS.minLongEdge) flags.push('too_small');
  if (input.enhancedLumaMean < QUALITY_THRESHOLDS.minLumaMean) flags.push('too_dark');
  if ((await laplacianVariance(input.enhanced)) < QUALITY_THRESHOLDS.minLaplacianVariance) flags.push('blurry');
  if ((await lumaStdev(input.original)) < QUALITY_THRESHOLDS.minLumaStdev) flags.push('low_contrast');
  return flags;
}
