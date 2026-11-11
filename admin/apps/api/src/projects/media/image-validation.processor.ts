import { Injectable, type OnModuleInit } from '@nestjs/common';
import { Readable } from 'node:stream';
import sharp from 'sharp';
import { ObjectProcessorRegistry, type ObjectProcessor, type ObjectProcessorResult, type StorageObject } from '@marinoscar/platform-api/storage';

export const HEIC_REJECTED_MESSAGE = 'HEIC not supported — set iPhone Camera ▸ Formats ▸ Most Compatible, or share as JPEG';
export const NOT_AN_IMAGE_MESSAGE = 'The file is not a valid JPEG, PNG or WebP image';
export const UNSUPPORTED_FORMAT_MESSAGE = 'Only JPEG, PNG and WebP images are supported';

export type SniffedFormat = 'jpeg' | 'png' | 'webp' | 'heic' | 'other-image' | 'unknown';

const HEIC_BRANDS = new Set(['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'hevm', 'hevs', 'mif1', 'msf1']);
const SNIFF_BYTES = 16;

/** The format a file's magic bytes announce, whatever its name or declared MIME type says. */
export function sniffImageFormat(head: Buffer): SniffedFormat {
  if (head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return 'jpeg';
  if (head.length >= 8 && head.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (head.length >= 12 && head.subarray(0, 4).toString('latin1') === 'RIFF' && head.subarray(8, 12).toString('latin1') === 'WEBP') return 'webp';
  if (head.length >= 12 && head.subarray(4, 8).toString('latin1') === 'ftyp') {
    return HEIC_BRANDS.has(head.subarray(8, 12).toString('latin1')) ? 'heic' : 'other-image';
  }
  if (head.length >= 6 && /^GIF8[79]a/.test(head.subarray(0, 6).toString('latin1'))) return 'other-image';
  if (head.length >= 4 && (head.subarray(0, 4).equals(Buffer.from([0x49, 0x49, 0x2a, 0x00])) || head.subarray(0, 4).equals(Buffer.from([0x4d, 0x4d, 0x00, 0x2a])))) return 'other-image';
  return 'unknown';
}

/** Reads the first bytes of a stream and returns a stream that replays them followed by the rest. */
async function peek(stream: Readable, bytes: number): Promise<{ head: Buffer; replay: Readable }> {
  const iterator = stream[Symbol.asyncIterator]();
  const chunks: Buffer[] = [];
  let length = 0;
  let done = false;
  while (length < bytes && !done) {
    const next = await iterator.next();
    if (next.done) done = true;
    else {
      const chunk = Buffer.isBuffer(next.value) ? next.value : Buffer.from(next.value);
      chunks.push(chunk);
      length += chunk.length;
    }
  }
  const head = Buffer.concat(chunks);
  async function* replay(): AsyncGenerator<Buffer> {
    for (const chunk of chunks) yield chunk;
    if (!done) {
      for (;;) {
        const next = await iterator.next();
        if (next.done) return;
        yield Buffer.isBuffer(next.value) ? next.value : Buffer.from(next.value);
      }
    }
  }
  return { head, replay: Readable.from(replay(), { objectMode: false }) };
}

/**
 * Validates an uploaded image: sniffs the magic bytes (JPEG, PNG, WebP; HEIC is
 * recognised and rejected with an actionable message), then reads the pixel
 * size with `sharp(stream).metadata()`. `optional: false`, so an invalid image
 * fails the storage object. Runs inside the platform job
 * `storage.object.process`, so it is already queue work.
 */
@Injectable()
export class ImageValidationProcessor implements ObjectProcessor, OnModuleInit {
  readonly name = 'project-image-validation';
  readonly priority = 10;
  readonly optional = false;

  constructor(private readonly registry: ObjectProcessorRegistry) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  canProcess(object: StorageObject): boolean {
    return object.mimeType.toLowerCase().startsWith('image/');
  }

  async process(_object: StorageObject, getStream: () => Promise<Readable>): Promise<ObjectProcessorResult> {
    const source = await getStream();
    try {
      const { head, replay } = await peek(source, SNIFF_BYTES);
      const format = sniffImageFormat(head);
      if (format === 'heic') return { success: false, error: HEIC_REJECTED_MESSAGE };
      if (format === 'unknown') return { success: false, error: NOT_AN_IMAGE_MESSAGE };
      if (format === 'other-image') return { success: false, error: UNSUPPORTED_FORMAT_MESSAGE };

      const decoder = sharp({ failOn: 'error' });
      replay.on('error', (error) => decoder.destroy(error));
      replay.pipe(decoder);
      const meta = await decoder.metadata();
      if (!meta.width || !meta.height) return { success: false, error: NOT_AN_IMAGE_MESSAGE };
      return { success: true, metadata: { width: meta.width, height: meta.height, format: meta.format } };
    } catch {
      // A truncated or corrupt file: sharp's own message can carry library detail, so the answer is fixed.
      return { success: false, error: NOT_AN_IMAGE_MESSAGE };
    } finally {
      source.destroy();
    }
  }
}
