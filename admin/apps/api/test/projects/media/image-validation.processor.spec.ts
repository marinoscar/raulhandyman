import { Readable } from 'node:stream';
import sharp from 'sharp';

import {
  HEIC_REJECTED_MESSAGE,
  ImageValidationProcessor,
  NOT_AN_IMAGE_MESSAGE,
  sniffImageFormat,
  UNSUPPORTED_FORMAT_MESSAGE,
} from '../../../src/projects/media/image-validation.processor';

const object = (mimeType: string) => ({ id: 'o1', name: 'a.jpg', mimeType }) as never;
const stream = (bytes: Buffer, chunkSize = 7): (() => Promise<Readable>) => async () => {
  const chunks: Buffer[] = [];
  for (let i = 0; i < bytes.length; i += chunkSize) chunks.push(bytes.subarray(i, i + chunkSize));
  return Readable.from(chunks);
};
const base = () => sharp({ create: { width: 64, height: 48, channels: 3, background: { r: 200, g: 100, b: 50 } } });

describe('ImageValidationProcessor', () => {
  const registry = { register: jest.fn() };
  const processor = new ImageValidationProcessor(registry as never);

  it('registers itself and is a required (non-optional) processor for image/* only', () => {
    processor.onModuleInit();
    expect(registry.register).toHaveBeenCalledWith(processor);
    expect(processor.optional).toBe(false);
    expect(processor.canProcess(object('image/jpeg'))).toBe(true);
    expect(processor.canProcess(object('IMAGE/PNG'))).toBe(true);
    expect(processor.canProcess(object('application/pdf'))).toBe(false);
  });

  it.each([
    ['jpeg', () => base().jpeg().toBuffer()],
    ['png', () => base().png().toBuffer()],
    ['webp', () => base().webp().toBuffer()],
  ])('accepts a valid %s and reports width, height and format (even in tiny chunks)', async (format, make) => {
    const bytes = await make();
    expect(await processor.process(object(`image/${format}`), stream(bytes, 5))).toEqual({ success: true, metadata: { width: 64, height: 48, format } });
  });

  it('fails a text file renamed .jpg', async () => {
    const result = await processor.process(object('image/jpeg'), stream(Buffer.from('hello, this is plain text, not a picture')));
    expect(result).toEqual({ success: false, error: NOT_AN_IMAGE_MESSAGE });
  });

  it('fails an empty file', async () => {
    expect(await processor.process(object('image/jpeg'), stream(Buffer.alloc(0)))).toEqual({ success: false, error: NOT_AN_IMAGE_MESSAGE });
  });

  it('fails a HEIC header with the actionable message', async () => {
    const heic = Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from('ftypheic'), Buffer.alloc(40)]);
    const result = await processor.process(object('image/heic'), stream(heic));
    expect(result).toEqual({ success: false, error: 'HEIC not supported — set iPhone Camera ▸ Formats ▸ Most Compatible, or share as JPEG' });
    expect(HEIC_REJECTED_MESSAGE).toBe(result.error);
  });

  it('fails a GIF and an AVIF as unsupported formats', async () => {
    expect((await processor.process(object('image/gif'), stream(Buffer.from('GIF89a' + '\0'.repeat(20), 'latin1')))).error).toBe(UNSUPPORTED_FORMAT_MESSAGE);
    const avif = Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from('ftypavif'), Buffer.alloc(20)]);
    expect((await processor.process(object('image/avif'), stream(avif))).error).toBe(UNSUPPORTED_FORMAT_MESSAGE);
  });

  it('fails a file with a JPEG header and a corrupt body, without leaking library detail', async () => {
    const bytes = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from('garbage garbage garbage')]);
    const result = await processor.process(object('image/jpeg'), stream(bytes));
    expect(result).toEqual({ success: false, error: NOT_AN_IMAGE_MESSAGE });
  });

  it('sniffs the magic bytes regardless of name', () => {
    expect(sniffImageFormat(Buffer.from([0xff, 0xd8, 0xff, 0xdb]))).toBe('jpeg');
    expect(sniffImageFormat(Buffer.from('RIFF\0\0\0\0WEBPVP8 '))).toBe('webp');
    expect(sniffImageFormat(Buffer.from('%PDF-1.7'))).toBe('unknown');
  });
});
