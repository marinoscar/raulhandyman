import sharp from 'sharp';

export type CropKey = 'card4x3' | 'hero16x9' | 'thumb' | 'og';

export interface CropSpec {
  key: CropKey;
  width: number;
  height: number;
  format: 'jpeg' | 'webp';
  quality: number;
}

/** The fixed frames of the site. `og` is unbranded here; branding is added by photo-og.ts. */
export const CROP_SPECS: readonly CropSpec[] = [
  { key: 'card4x3', width: 1600, height: 1200, format: 'jpeg', quality: 82 },
  { key: 'hero16x9', width: 2400, height: 1350, format: 'jpeg', quality: 82 },
  { key: 'thumb', width: 480, height: 360, format: 'webp', quality: 75 },
  { key: 'og', width: 1200, height: 630, format: 'jpeg', quality: 85 },
];

export const AI_RENDITION_EDGE = 1024;

export interface Focal {
  /** 0..1 across the image. */
  x: number;
  y: number;
}

export interface Rendition {
  key: CropKey | 'ai1024';
  buffer: Buffer;
  width: number;
  height: number;
  mimeType: 'image/jpeg' | 'image/webp';
  ext: 'jpg' | 'webp';
}

const PROXY_EDGE = 512;
const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

/**
 * The initial focal point: sharp's attention strategy on a 512px proxy. Two
 * one-axis crops (a wide and a tall one) each report where the most interesting
 * region is, so both axes get an answer even on a near-square image.
 */
export async function findFocalPoint(master: Buffer): Promise<Focal> {
  const proxy = await sharp(master).resize(PROXY_EDGE, PROXY_EDGE, { fit: 'inside' }).removeAlpha().png().toBuffer();
  const { width, height } = await sharp(proxy).metadata();
  if (!width || !height) return { x: 0.5, y: 0.5 };
  const wide = await sharp(proxy)
    .resize(width, Math.max(1, Math.round(height / 2)), { fit: 'cover', position: sharp.strategy.attention })
    .toBuffer({ resolveWithObject: true });
  const tall = await sharp(proxy)
    .resize(Math.max(1, Math.round(width / 2)), height, { fit: 'cover', position: sharp.strategy.attention })
    .toBuffer({ resolveWithObject: true });
  const y = (wide.info as { attentionY?: number }).attentionY;
  const x = (tall.info as { attentionX?: number }).attentionX;
  return {
    x: clamp(typeof x === 'number' ? x / width : 0.5, 0, 1),
    y: clamp(typeof y === 'number' ? y / height : 0.5, 0, 1),
  };
}

/** The crop window of aspect `targetW:targetH`: the largest that fits, centred on the focal point and clamped to the bounds. */
export function cropWindow(imageW: number, imageH: number, targetW: number, targetH: number, focal: Focal): { left: number; top: number; width: number; height: number } {
  const ratio = targetW / targetH;
  let width = Math.min(imageW, Math.floor(imageH * ratio));
  let height = Math.round(width / ratio);
  if (height > imageH) {
    height = imageH;
    width = Math.min(imageW, Math.floor(height * ratio));
  }
  const left = clamp(Math.round(focal.x * imageW - width / 2), 0, imageW - width);
  const top = clamp(Math.round(focal.y * imageH - height / 2), 0, imageH - height);
  return { left, top, width, height };
}

async function encode(pipeline: sharp.Sharp, spec: Pick<CropSpec, 'format' | 'quality'>): Promise<Buffer> {
  return spec.format === 'webp' ? pipeline.webp({ quality: spec.quality }).toBuffer() : pipeline.jpeg({ quality: spec.quality, mozjpeg: true }).toBuffer();
}

/** One rendition around the focal point. Never upscales: a source smaller than the target yields its largest crop of the right ratio. */
export async function makeCrop(master: Buffer, focal: Focal, spec: CropSpec): Promise<Rendition> {
  const { width: imageW = 0, height: imageH = 0 } = await sharp(master).metadata();
  const window = cropWindow(imageW, imageH, spec.width, spec.height, focal);
  const scale = Math.min(1, window.width / spec.width);
  const outW = scale === 1 ? spec.width : window.width;
  const outH = scale === 1 ? spec.height : Math.round(window.width / (spec.width / spec.height));
  const pipeline = sharp(master).extract(window);
  const buffer = await encode(pipeline.resize(outW, outH, { fit: 'fill' }), spec);
  return {
    key: spec.key,
    buffer,
    width: outW,
    height: outH,
    mimeType: spec.format === 'webp' ? 'image/webp' : 'image/jpeg',
    ext: spec.format === 'webp' ? 'webp' : 'jpg',
  };
}

/** The AI input: the long edge at 1024, never upscaled, JPEG q80. Not public. */
export async function makeAiRendition(master: Buffer): Promise<Rendition> {
  const { data, info } = await sharp(master)
    .resize(AI_RENDITION_EDGE, AI_RENDITION_EDGE, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 80, mozjpeg: true })
    .toBuffer({ resolveWithObject: true });
  return { key: 'ai1024', buffer: data, width: info.width, height: info.height, mimeType: 'image/jpeg', ext: 'jpg' };
}

/** `card4x3`, `hero16x9`, `thumb`, `og` (unbranded) and `ai1024`, cropped around `focal`. */
export async function makeCrops(master: Buffer, focal: Focal, keys: readonly (CropKey | 'ai1024')[] = [...CROP_SPECS.map((spec) => spec.key), 'ai1024']): Promise<Rendition[]> {
  const out: Rendition[] = [];
  for (const key of keys) {
    if (key === 'ai1024') out.push(await makeAiRendition(master));
    else out.push(await makeCrop(master, focal, CROP_SPECS.find((spec) => spec.key === key) as CropSpec));
  }
  return out;
}
