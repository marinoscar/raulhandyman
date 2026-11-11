import { registerKeyPrefix, storageKeyPrefixRegistry } from '@marinoscar/platform-api/storage';

import { PROJECT_MEDIA_KEY_PREFIX } from '../../../src/platform/storage/storage-prefixes';
import { PHOTO_PROCESS_JOB, PhotoProcessHandler, safeProcessingError, townName } from '../../../src/projects/media/photo-process.job';
import { projectMediaKey } from '../../../src/projects/media/project-media.store';
import { PROJECTS_SETTINGS_DEFAULTS, type ProjectsSettings } from '../../../src/projects/projects.settings.schemas';
import { sceneJpeg } from './fixtures';

if (!storageKeyPrefixRegistry.get('project-media')) registerKeyPrefix(PROJECT_MEDIA_KEY_PREFIX);

const ORG = '11111111-1111-4111-8111-111111111111';
const PROJECT = '22222222-2222-4222-8222-222222222222';
const PHOTO = '33333333-3333-4333-8333-333333333333';
const ORIGINAL = '44444444-4444-4444-8444-444444444444';
const ENHANCED = '55555555-5555-4555-8555-555555555555';

interface Harness {
  handler: PhotoProcessHandler;
  updates: Record<string, unknown>[];
  writes: Array<{ name: string; buffer: Buffer }>;
  reads: string[];
  store: { read: jest.Mock; write: jest.Mock };
  photo: Record<string, unknown>;
}

function build(opts: { cover?: boolean; photo?: Record<string, unknown>; settings?: Partial<ProjectsSettings>; original?: Buffer; readFails?: Error; events?: unknown; metrics?: unknown } = {}): Harness {
  const photo = {
    id: PHOTO,
    projectId: PROJECT,
    orgId: ORG,
    originalObjectId: ORIGINAL,
    enhancedObjectId: null,
    renditions: null,
    focalX: 0.5,
    focalY: 0.5,
    createdById: null,
    project: { title: 'Deck repair and stain', townSlug: 'north-richland-hills', coverPhotoId: opts.cover === false ? null : PHOTO },
    ...(opts.photo ?? {}),
  };
  const updates: Record<string, unknown>[] = [];
  const writes: Array<{ name: string; buffer: Buffer }> = [];
  const reads: string[] = [];
  // Ids are stable per key: the real store upserts on the storage key.
  const ids = new Map<string, string>();
  const store = {
    read: jest.fn(async (id: string) => {
      reads.push(id);
      if (opts.readFails) throw opts.readFails;
      return opts.original as Buffer;
    }),
    write: jest.fn(async (file: { name: string; buffer: Buffer; orgId: string; projectId: string; photoId: string }) => {
      writes.push({ name: file.name, buffer: file.buffer });
      const key = projectMediaKey(file.orgId, file.projectId, file.photoId, file.name);
      if (!ids.has(key)) ids.set(key, `00000000-0000-4000-8000-${String(ids.size + 1).padStart(12, '0')}`);
      return ids.get(key);
    }),
  };
  const tx = {
    projectPhoto: {
      findFirst: jest.fn(async () => photo),
      update: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        updates.push(data);
        return {};
      }),
    },
  };
  const scope = { run: jest.fn(async (_job: unknown, fn: (tx: unknown) => Promise<unknown>) => fn(tx)) };
  const settings = { getNamespace: jest.fn(async () => ({ ...PROJECTS_SETTINGS_DEFAULTS, ...(opts.settings ?? {}) })) };
  const registry = { register: jest.fn() };
  const handler = new PhotoProcessHandler(registry as never, scope as never, settings as never, store as never, opts.events as never, opts.metrics as never);
  return { handler, updates, writes, reads, store, photo };
}

const job = (stages: string[], extra: Record<string, unknown> = {}) =>
  ({ id: 'job-1', type: PHOTO_PROCESS_JOB, orgId: ORG, payload: { orgId: ORG, projectId: PROJECT, photoId: PHOTO, stages }, ...extra }) as never;
const ALL = ['enhance', 'crops', 'og'];

describe('projects.photo.process job', () => {
  let original: Buffer;
  beforeAll(async () => {
    original = await sceneJpeg(1400, 1000, { cast: [0.85, 0.95, 1.08] });
  });

  it('is registered under its permanent type, is server-only and declares its profile', () => {
    const h = build({ original });
    h.handler.onModuleInit();
    expect(PHOTO_PROCESS_JOB).toBe('projects.photo.process');
    expect(h.handler.type).toBe('projects.photo.process');
    expect(h.handler.label).toBe('Process project photo');
    expect(h.handler.profile).toEqual({ maxRuntimeMs: 120_000, maxAttempts: 3 });
    expect((h.handler as { nodeResultSchema?: unknown }).nodeResultSchema).toBeUndefined();
    expect((h.handler as { persistNodeResult?: unknown }).persistNodeResult).toBeUndefined();
  });

  it('enhances, cuts the renditions and renders the OG for the cover photo, then marks the photo ready', async () => {
    const h = build({ original });
    await h.handler.process(job(ALL));

    expect(h.updates[0]).toMatchObject({ processingStatus: 'processing', processingError: null });
    const afterEnhance = h.updates[1];
    expect(afterEnhance).toMatchObject({ width: 1400, height: 1000, qualityFlags: expect.any(Array) });
    expect(afterEnhance.enhancedObjectId).toEqual(expect.any(String));
    expect(afterEnhance.dominantColor).toMatch(/^#[0-9a-f]{6}$/);

    const last = h.updates[h.updates.length - 1];
    expect(last).toMatchObject({ processingStatus: 'ready', processingError: null });
    expect(Object.keys(last.renditions as object).sort()).toEqual(['ai1024', 'card4x3', 'hero16x9', 'og', 'ogBranded', 'thumb']);
    expect((last.renditions as Record<string, { w: number; h: number }>).ogBranded).toMatchObject({ w: 1200, h: 630 });
    // 1400x1000 is smaller than the 1600x1200 card: never upscaled.
    expect((last.renditions as Record<string, { w: number; h: number }>).card4x3.w).toBeLessThanOrEqual(1400);
    expect(last.focalX).toEqual(expect.any(Number));
    expect(h.writes.map((w) => w.name).sort()).toEqual(['ai1024.jpg', 'card4x3.jpg', 'enhanced.jpg', 'hero16x9.jpg', 'og-branded.jpg', 'og.jpg', 'thumb.webp']);
  }, 60_000);

  it('does not render a branded OG for a photo that is not the cover, or when OG is disabled', async () => {
    const notCover = build({ original, cover: false });
    await notCover.handler.process(job(ALL));
    expect(notCover.writes.map((w) => w.name)).not.toContain('og-branded.jpg');

    const disabled = build({ original, settings: { og: { enabled: false } } });
    await disabled.handler.process(job(ALL));
    expect(disabled.writes.map((w) => w.name)).not.toContain('og-branded.jpg');
  }, 60_000);

  it('records a failed status with a user-safe message and rethrows so the queue retries', async () => {
    const h = build({ original, readFails: new Error('Input buffer contains unsupported image format at /srv/secret/path') });
    await expect(h.handler.process(job(ALL))).rejects.toThrow(/unsupported image format/);
    const last = h.updates[h.updates.length - 1];
    expect(last.processingStatus).toBe('failed');
    expect(last.processingError).toBe('The photo could not be read. Upload it again as a JPEG, PNG or WebP.');
    expect(String(last.processingError)).not.toContain('/srv');
  });

  it('a re-run overwrites the same keys and storage objects: nothing is duplicated', async () => {
    const h = build({ original });
    await h.handler.process(job(ALL));
    const firstNames = h.writes.map((w) => w.name).sort();
    const firstIds = (h.updates[h.updates.length - 1].renditions as Record<string, { objectId: string }>).card4x3.objectId;
    const firstEnhancedId = h.updates[1].enhancedObjectId;
    h.writes.length = 0;
    h.updates.length = 0;
    await h.handler.process(job(ALL));
    expect(h.writes.map((w) => w.name).sort()).toEqual(firstNames);
    expect(h.updates[1].enhancedObjectId).toBe(firstEnhancedId);
    expect((h.updates[h.updates.length - 1].renditions as Record<string, { objectId: string }>).card4x3.objectId).toBe(firstIds);
  }, 60_000);

  it('a crops-only run (a focal change) leaves the enhanced object alone and keeps the focal point', async () => {
    const master = await sceneJpeg(1800, 1200);
    const h = build({
      original: master,
      photo: { enhancedObjectId: ENHANCED, renditions: { card4x3: { objectId: 'x', w: 1, h: 1 } }, focalX: 0.8, focalY: 0.3 },
    });
    await h.handler.process(job(['crops']));
    expect(h.reads).toEqual([ENHANCED]);
    expect(h.writes.map((w) => w.name)).not.toContain('enhanced.jpg');
    const last = h.updates[h.updates.length - 1];
    expect(last).toMatchObject({ focalX: 0.8, focalY: 0.3, processingStatus: 'ready' });
    expect(last).not.toHaveProperty('enhancedObjectId');
    // The cover's OG follows the new crop.
    expect(h.writes.map((w) => w.name)).toContain('og-branded.jpg');
  }, 60_000);

  it('an og-only run re-renders just the branded image', async () => {
    const master = await sceneJpeg(1800, 1200);
    const h = build({ original: master, photo: { enhancedObjectId: ENHANCED, renditions: { card4x3: { objectId: 'x', w: 1, h: 1 } } } });
    await h.handler.process(job(['og']));
    expect(h.writes.map((w) => w.name)).toEqual(['og-branded.jpg']);
    const renditions = h.updates[h.updates.length - 1].renditions as Record<string, unknown>;
    expect(renditions.card4x3).toBeDefined();
    expect(renditions.ogBranded).toBeDefined();
  }, 60_000);

  it('uses the grade settings: changing grade.warmth changes the next processed photo', async () => {
    const cool = build({ original, settings: { grade: { warmth: 0, saturation: 1.06 } } });
    const warm = build({ original, settings: { grade: { warmth: 0.25, saturation: 1.06 } } });
    await cool.handler.process(job(['enhance']));
    await warm.handler.process(job(['enhance']));
    const enhancedOf = (h: Harness): Buffer => h.writes.find((w) => w.name === 'enhanced.jpg')!.buffer;
    expect(enhancedOf(cool).equals(enhancedOf(warm))).toBe(false);
  }, 60_000);

  it('rejects an invalid payload and a payload for another organization', async () => {
    const h = build({ original });
    await expect(h.handler.process(job([]))).rejects.toThrow();
    await expect(h.handler.process(job(['resize']))).rejects.toThrow();
    await expect(h.handler.process(job(ALL, { orgId: '99999999-9999-4999-8999-999999999999' }))).rejects.toThrow(/organization/);
  });

  it('returns quietly when the photo was deleted meanwhile', async () => {
    const h = build({ original });
    (h.handler as unknown as { scope: { run: jest.Mock } }).scope.run.mockImplementationOnce(async () => null);
    await expect(h.handler.process(job(ALL))).resolves.toBeUndefined();
    expect(h.updates).toHaveLength(0);
  });
});

describe('projects.photo.process events and metrics', () => {
  let original: Buffer;
  beforeAll(async () => {
    original = await sceneJpeg(1400, 1000, { cast: [0.85, 0.95, 1.08] });
  });

  it('announces the ready photo once to its uploader, after the last write, and records each stage', async () => {
    const order: string[] = [];
    const events = { publishPhotoReady: jest.fn(() => void order.push('event')) };
    const metrics = { photoStage: jest.fn() };
    const h = build({ original, photo: { createdById: 'user-up' }, events, metrics });
    const origUpdate = h.updates.push.bind(h.updates);
    h.updates.push = ((...items: Record<string, unknown>[]) => {
      order.push(`update:${String(items[0]?.processingStatus ?? 'x')}`);
      return origUpdate(...items);
    }) as never;
    await h.handler.process(job(ALL));
    expect(events.publishPhotoReady).toHaveBeenCalledTimes(1);
    expect(events.publishPhotoReady).toHaveBeenCalledWith({ orgId: ORG, projectId: PROJECT, photoId: PHOTO, uploaderId: 'user-up', status: 'ok' });
    expect(order[order.length - 1]).toBe('event');
    expect(order[order.length - 2]).toBe('update:ready');
    const stages = metrics.photoStage.mock.calls.map((call: unknown[]) => [call[0], call[1]]);
    expect(stages).toEqual([['enhance', 'ok'], ['crops', 'ok'], ['og', 'ok']]);
    for (const call of metrics.photoStage.mock.calls) expect(call[2]).toEqual(expect.any(Number));
  }, 60_000);

  it('announces a failure only on the last attempt, records the failed stage, and a throwing publisher never fails the job', async () => {
    const events = { publishPhotoReady: jest.fn() };
    const metrics = { photoStage: jest.fn() };
    const early = build({ original, readFails: new Error('Input buffer contains unsupported image format'), events, metrics });
    await expect(early.handler.process(job(ALL, { attempts: 1 }))).rejects.toThrow();
    expect(events.publishPhotoReady).not.toHaveBeenCalled();

    const last = build({ original, readFails: new Error('Input buffer contains unsupported image format'), events });
    await expect(last.handler.process(job(ALL, { attempts: 3 }))).rejects.toThrow(/unsupported/);
    expect(events.publishPhotoReady).toHaveBeenCalledWith(expect.objectContaining({ status: 'failed', photoId: PHOTO }));

    const throwing = build({ original, events: { publishPhotoReady: jest.fn(() => { throw new Error('boom'); }) } });
    await expect(throwing.handler.process(job(['crops']))).resolves.toBeUndefined();
  }, 60_000);
});

describe('helpers', () => {
  it('builds org-scoped storage keys under project-media/', () => {
    expect(projectMediaKey(ORG, PROJECT, PHOTO, 'enhanced.jpg')).toBe(`project-media/${ORG}/${PROJECT}/${PHOTO}/enhanced.jpg`);
    expect(projectMediaKey(ORG, PROJECT, PHOTO, 'enhanced.jpg')).toBe(projectMediaKey(ORG, PROJECT, PHOTO, 'enhanced.jpg'));
  });

  it('maps errors to messages that carry no internals', () => {
    expect(safeProcessingError(new Error('Storage object x not found'))).toMatch(/could not be found/);
    expect(safeProcessingError(new Error('S3 bucket unreachable'))).toMatch(/Storage is not available/);
    expect(safeProcessingError(new Error('something /etc/passwd'))).toBe('The photo could not be processed. Try again or upload it again.');
    expect(safeProcessingError('weird')).toBe('The photo could not be processed. Try again or upload it again.');
  });

  it('turns a town slug into a display name', () => {
    expect(townName('north-richland-hills')).toBe('North Richland Hills');
    expect(townName('plano')).toBe('Plano');
  });
});
