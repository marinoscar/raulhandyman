// `projects.photo.retouch` over the platform's AI harness (scripted fake image
// provider, no network, no key) and real sharp pixels.
import { Logger } from '@nestjs/common';
import sharp from 'sharp';

import { PROJECTS_RETOUCH_FEATURE_ID } from '../../../src/platform/ai/projects-retouch.feature';
import { PHOTO_RETOUCH_JOB } from '../../../src/projects/ai/projects-ai.constants';
import { buildRetouchPrompt } from '../../../src/projects/ai/projects-retouch.prompt';
import { RETOUCHED_RENDITION_KEYS, retouchCanvas, RetouchJobHandler } from '../../../src/projects/ai/retouch.job';
import { makeCrops } from '../../../src/projects/media/photo-crops';
import { PROJECTS_SETTINGS_DEFAULTS } from '../../../src/projects/projects.settings.schemas';
import { sceneJpeg } from '../media/fixtures';
import { ENHANCED, fakeScope, harness, moduleRefOf, ORG, PHOTO_1, photoRow, PROJECT, projectRow, USER } from './ai-test-kit';

beforeAll(() => Logger.overrideLogger(false));

// Rendering a scene pixel by pixel is slow: do it once for the whole file.
let imagesPromise: Promise<{ master: Buffer; edited: Buffer }> | undefined;
const images = () =>
  (imagesPromise ??= (async () => ({
    master: await sceneJpeg(1500, 1000),
    // The "model output": a JPEG that carries EXIF, as a provider's image might.
    edited: await sharp(await sceneJpeg(1536, 1024, { seed: 7 } as never)).withExif({ IFD0: { Copyright: 'Someone' } }).jpeg().toBuffer(),
  }))());

async function build(opts: { role?: string; photo?: Record<string, any>; flipRoleDuringCall?: boolean; noImageModel?: boolean; aiFails?: boolean } = {}) {
  const { master, edited } = await images();
  const photo = photoRow(PHOTO_1, null, { role: opts.role ?? 'after', enhancedObjectId: ENHANCED, width: 1500, height: 1000, focalX: 0.25, focalY: 0.4, ...(opts.photo ?? {}) });
  const calls: any[] = [];
  const h = harness({
    models: opts.noImageModel ? [{ modelId: 'fake-model' }] : undefined,
    fake: {
      ports: {
        images: {
          generate: async () => {
            throw new Error('not used');
          },
          edit: async (req: any) => {
            calls.push(req);
            if (opts.flipRoleDuringCall) photo.role = 'before';
            if (opts.aiFails) throw new Error('provider said: secret sk-live-123');
            return { provider: 'openai', model: req.model, images: [{ data: edited, mimeType: 'image/jpeg' }], usage: { inputTokens: 1 } };
          },
        },
      },
    },
  });
  const { scope, writes } = fakeScope(projectRow(), [photo]);
  const written: Array<{ name: string; buffer: Buffer }> = [];
  const ids = new Map<string, string>();
  const store = {
    read: jest.fn(async () => master),
    write: jest.fn(async (file: { name: string; buffer: Buffer }) => {
      written.push({ name: file.name, buffer: file.buffer });
      if (!ids.has(file.name)) ids.set(file.name, `66666666-6666-4666-8666-${String(ids.size + 1).padStart(12, '0')}`);
      return ids.get(file.name);
    }),
  };
  const settings = { getNamespace: jest.fn(async () => PROJECTS_SETTINGS_DEFAULTS) };
  const events = { publishRetouchReady: jest.fn() };
  const metrics = { aiRetouch: jest.fn() };
  const handler = new RetouchJobHandler({ register: jest.fn() } as never, scope, h.ai, moduleRefOf(h), store as never, settings as never, events as never, metrics as never);
  return { h, handler, photo, writes, store, written, events, calls, metrics };
}
const job = (options?: Record<string, unknown>) =>
  ({ id: 'job-2', type: PHOTO_RETOUCH_JOB, orgId: ORG, payload: { orgId: ORG, projectId: PROJECT, photoId: PHOTO_1, userId: USER, ...(options ? { options } : {}) } }) as never;

describe('projects.photo.retouch job', () => {
  it('is a permanent, server-only type with its declared profile', async () => {
    const { handler } = await build();
    expect(handler.type).toBe('projects.photo.retouch');
    expect(handler.profile).toEqual({ maxRuntimeMs: 180_000, maxAttempts: 2 });
    expect('nodeResultSchema' in handler).toBe(false);
    expect('persistNodeResult' in handler).toBe(false);
  });

  it('stores the retouched image, sets the flags and leaves chosenVariant alone', async () => {
    const t = await build({ photo: { chosenVariant: 'enhanced' } });
    await t.handler.process(job());

    expect(t.writes.photos).toHaveLength(1);
    const data = t.writes.photos[0]!.data;
    expect(data.aiRetouched).toBe(true);
    expect(data.retouchedObjectId).toMatch(/^66666666/);
    expect('chosenVariant' in data).toBe(false);
    expect(Object.keys(data.renditions)).toEqual(expect.arrayContaining(Object.values(RETOUCHED_RENDITION_KEYS)));
    expect(t.written.map((file) => file.name).sort()).toEqual(['retouched-card4x3.jpg', 'retouched-hero16x9.jpg', 'retouched-og.jpg', 'retouched-thumb.webp', 'retouched.jpg']);
    expect(t.events.publishRetouchReady).toHaveBeenCalledWith({ orgId: ORG, projectId: PROJECT, userId: USER, photoId: PHOTO_1, jobId: 'job-2' });
    expect(t.metrics.aiRetouch.mock.calls).toEqual([['ok']]);
  });

  it('sends the fixed prompt, a PNG at the model size and the feature id; no key or URL appears anywhere', async () => {
    const t = await build();
    await t.handler.process(job());

    expect(t.calls).toHaveLength(1);
    const request = t.calls[0];
    expect(request.prompt).toBe(buildRetouchPrompt());
    expect(request.model).toBe('fake-image-model');
    expect(request.size).toBe('1536x1024');
    expect(request.images).toHaveLength(1);
    expect(request.images[0].mimeType).toBe('image/png');
    const meta = await sharp(Buffer.from(request.images[0].data)).metadata();
    expect(meta.format).toBe('png');
    expect(meta.width).toBeLessThanOrEqual(1536);
    expect(t.h.usageEvents.length).toBeGreaterThan(0);
    expect(t.h.usageEvents.every((event) => event.feature === PROJECTS_RETOUCH_FEATURE_ID)).toBe(true);
    expect(JSON.stringify(t.h.runRows)).not.toMatch(/sk-/);
  });

  it('strips metadata and cuts the crops around the photo own focal point', async () => {
    const t = await build();
    await t.handler.process(job());

    for (const file of t.written) {
      const meta = await sharp(file.buffer).metadata();
      expect(meta.exif).toBeUndefined();
      expect(meta.xmp).toBeUndefined();
    }
    const master = t.written.find((file) => file.name === 'retouched.jpg')!.buffer;
    const [card] = await makeCrops(master, { x: 0.25, y: 0.4 }, ['card4x3']);
    expect(t.written.find((file) => file.name === 'retouched-card4x3.jpg')!.buffer.equals(card!.buffer)).toBe(true);
    const [centred] = await makeCrops(master, { x: 0.5, y: 0.5 }, ['card4x3']);
    expect(centred!.buffer.equals(card!.buffer)).toBe(false);
  });

  it('refuses a before photo without calling the model or storing anything', async () => {
    const t = await build({ role: 'before' });
    await expect(t.handler.process(job())).rejects.toMatchObject({ name: 'SafeJobError', message: expect.stringContaining('Before photos are never retouched') });
    expect(t.calls).toHaveLength(0);
    expect(t.store.write).not.toHaveBeenCalled();
    expect(t.writes.photos).toHaveLength(0);
  });

  it('fails safely when the role was flipped to before after the job was enqueued', async () => {
    const t = await build({ flipRoleDuringCall: true });
    await expect(t.handler.process(job())).rejects.toMatchObject({ message: expect.stringContaining('Before photos are never retouched') });
    expect(t.store.write).not.toHaveBeenCalled();
    expect(t.writes.photos).toHaveLength(0);
    expect(t.events.publishRetouchReady).not.toHaveBeenCalled();
  });

  it('turns a provider failure into a user-safe message without the provider text', async () => {
    const t = await build({ aiFails: true });
    const error = await t.handler.process(job()).catch((e: Error) => e);
    expect((error as Error).message).not.toMatch(/sk-live|provider said/);
    expect(t.writes.photos).toHaveLength(0);
    expect(t.metrics.aiRetouch.mock.calls).toEqual([['failed']]);
  });

  it('fails clearly when the administrator enabled no image-editing model', async () => {
    const t = await build({ noImageModel: true });
    await expect(t.handler.process(job())).rejects.toMatchObject({ message: expect.stringContaining('No image-editing model is enabled') });
  });

  it('needs an enhanced master', async () => {
    const t = await build({ photo: { enhancedObjectId: null } });
    await expect(t.handler.process(job())).rejects.toMatchObject({ message: expect.stringContaining('not processed yet') });
  });
});

describe('retouch canvas', () => {
  it.each([
    [3000, 2000, '1536x1024'],
    [2000, 3000, '1024x1536'],
    [1000, 1000, '1024x1024'],
    [1100, 1000, '1024x1024'],
  ])('%ix%i uses %s', (w, h, size) => {
    expect(retouchCanvas(w, h).size).toBe(size);
  });
});
