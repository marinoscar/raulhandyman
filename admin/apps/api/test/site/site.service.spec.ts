// SiteService against an in-memory organization database: the manifest holds only
// published projects, never private fields, validates against both schemas; the
// ETag short-circuits; media of an unpublished project is a 404; the build-status
// seams run after the state is written.
import Ajv2020 from 'ajv/dist/2020';
import addFormats from 'ajv-formats';
import { NotFoundException } from '@nestjs/common';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import sharp from 'sharp';

import { siteManifestSchema } from '../../src/site/site-manifest.schema';
import { SiteMediaService } from '../../src/site/site-media.service';
import { SiteEventsPublisher, SitePingPort } from '../../src/site/site.ports';
import { manifestEtag, SiteService } from '../../src/site/site.service';

const ORG = '11111111-1111-4111-8111-111111111111';
const P_PUB = '00000000-0000-4000-8000-0000000000a1';
const P_DRAFT = '00000000-0000-4000-8000-0000000000a2';
const PH_PUB = '00000000-0000-4000-8000-0000000000b1';
const PH_DRAFT = '00000000-0000-4000-8000-0000000000b2';
const KEY = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';
const obj = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv as never);
const jsonValidate = ajv.compile(JSON.parse(readFileSync(resolve(__dirname, '../../../../../src/content/manifest.schema.json'), 'utf8')));

const photoRow = (id: string, projectId: string, base: number) => ({
  id,
  projectId,
  sortOrder: 0,
  role: 'after',
  altText: 'A repaired fence section',
  caption: '',
  fileSlug: 'fence-after',
  focalX: 0.5,
  focalY: 0.4,
  width: 64,
  height: 48,
  dominantColor: '#8a7f70',
  chosenVariant: 'enhanced',
  originalObjectId: obj(base),
  enhancedObjectId: obj(base + 1),
  retouchedObjectId: null,
  processingStatus: 'ready',
  aiSuggestion: { secret: 'x' },
  renditions: {
    card4x3: { objectId: obj(base + 2), w: 40, h: 30 },
    hero16x9: { objectId: obj(base + 3), w: 48, h: 27 },
    og: { objectId: obj(base + 4), w: 1200, h: 630 },
    ogBranded: { objectId: obj(base + 5), w: 1200, h: 630 },
  },
});

const projectRow = (id: string, status: string, slug: string) => ({
  id,
  orgId: ORG,
  status,
  slug,
  previousSlugs: status === 'published' ? ['older-slug'] : [],
  title: 'Fence post replaced',
  seoTitle: 'Fence post replacement in Conroe',
  metaDescription: 'A rotted fence post replaced and the boards re-hung.',
  summary: 'New post, new concrete, boards re-hung.',
  body: '## Done\n\nText.',
  serviceSlug: 'fence-and-deck-repair',
  townSlug: 'conroe',
  completedOn: new Date('2026-10-02'),
  featured: false,
  coverPhotoId: id === P_PUB ? PH_PUB : PH_DRAFT,
  publishedAt: new Date('2026-10-05T14:00:00Z'),
  updatedAt: new Date('2026-10-09T16:30:00Z'),
  workNotes: 'PRIVATE customer phone 555-0100',
  aiSuggestion: { title: 'PRIVATE' },
  createdById: 'user-secret',
});

async function harness(opts: { key?: string | null } = {}) {
  const jpeg = await sharp({ create: { width: 64, height: 48, channels: 3, background: '#887766' } }).jpeg().toBuffer();
  const projects = [projectRow(P_PUB, 'published', 'fence-post-replacement-conroe'), projectRow(P_DRAFT, 'draft', 'draft-project')];
  const photos = [photoRow(PH_PUB, P_PUB, 100), photoRow(PH_DRAFT, P_DRAFT, 200)];
  const state: Record<string, unknown>[] = [];
  const order: string[] = [];
  const statusOf = (projectId: string) => projects.find((p) => p.id === projectId)!.status;
  const tx = {
    project: {
      findMany: jest.fn(async ({ where }: { where: { status?: string } }) =>
        projects.filter((p) => (where.status ? p.status === where.status : true)).map((p) => ({ ...p, photos: photos.filter((ph) => ph.projectId === p.id) })),
      ),
    },
    projectPhoto: {
      findFirst: jest.fn(async ({ where }: { where: { id: string } }) => {
        const photo = photos.find((ph) => ph.id === where.id);
        return photo && statusOf(photo.projectId) === 'published' ? photo : null;
      }),
    },
    storageObject: { findMany: jest.fn(async ({ where }: { where: { id: { in: string[] } } }) => where.id.in.map((id) => ({ id, updatedAt: new Date(1_700_000_000_000) }))) },
    sitePublishState: {
      findFirst: jest.fn(async () => state[0] ?? null),
      upsert: jest.fn(async ({ create, update }: { create: Record<string, unknown>; update: Record<string, unknown> }) => {
        order.push('commit');
        state[0] = { ...(state[0] ?? create), ...update };
        return state[0];
      }),
    },
  };
  const prisma = { runInOrg: jest.fn(async (_org: string, fn: (t: unknown) => Promise<unknown>) => fn(tx)) };
  const store = { read: jest.fn(async () => jpeg) };
  const media = new SiteMediaService(prisma as never, store as never);
  const keys = { get: jest.fn(async () => (opts.key === undefined ? null : opts.key)) };
  const events = Object.assign(new SiteEventsPublisher(), {
    publishBuildLive: jest.fn(() => void order.push('live-event')),
    publishBuildFailed: jest.fn(() => void order.push('failed-event')),
  });
  const ping = { requestPing: jest.fn(() => void order.push('ping')) };
  const service = new SiteService(prisma as never, media, keys as never, events, ping as unknown as SitePingPort);
  return { service, state, order, events, ping, store, tx };
}

describe('SiteService.buildManifest', () => {
  it('contains only published projects and validates against both schemas', async () => {
    const { service } = await harness({ key: KEY });
    const manifest = await service.buildManifest(ORG);
    expect(manifest.projects.map((p) => p.id)).toEqual([P_PUB]);
    expect(siteManifestSchema.safeParse(manifest).success).toBe(true);
    expect(jsonValidate(JSON.parse(JSON.stringify(manifest)))).toBe(true);
    expect(manifest.indexNowKey).toBe(KEY);
    const photo = manifest.projects[0].photos[0];
    expect(photo.renditions.master.path).toBe(`media/${PH_PUB}/master.jpg`);
    expect(photo.renditions.card4x3).toMatchObject({ width: 40, height: 30 });
    expect(photo.renditions.master.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(photo.caption).toBeNull();
    expect(manifest.projects[0].ogImage).toEqual({ path: `media/${PH_PUB}/og-branded.jpg`, width: 1200, height: 630 });
    expect(manifest.projects[0].townName).toBe('Conroe');
    expect(manifest.redirects).toEqual([{ from: '/projects/older-slug/', to: '/projects/fence-post-replacement-conroe/' }]);
  });

  it('never carries workNotes, aiSuggestion, user ids or storage keys', async () => {
    const { service } = await harness();
    const text = JSON.stringify(await service.buildManifest(ORG));
    for (const secret of ['workNotes', 'PRIVATE', 'aiSuggestion', 'user-secret', 'createdById', 'storageKey', 'ObjectId']) expect(text).not.toContain(secret);
  });

  it('leaves out a photo that is not ready, and a project left with none', async () => {
    const h = await harness();
    h.tx.project.findMany.mockImplementationOnce(async () => []);
    // second call (the manifest read) returns the project with an unprocessed photo
    h.tx.project.findMany.mockImplementationOnce(async () => [{ ...projectRow(P_PUB, 'published', 'x-project'), photos: [{ ...photoRow(PH_PUB, P_PUB, 100), processingStatus: 'processing' }] }]);
    expect((await h.service.buildManifest(ORG)).projects).toEqual([]);
  });
});

describe('SiteService.getContent', () => {
  it('answers a matching If-None-Match without building', async () => {
    const h = await harness();
    const version = await h.service.contentVersion(ORG);
    h.store.read.mockClear();
    const result = await h.service.getContent(ORG, `"${version}"`);
    expect(result.manifest).toBeNull();
    expect(result.etag).toBe(`"${version}"`);
    expect(h.store.read).not.toHaveBeenCalled();
  });

  it('returns the manifest with the content version as ETag otherwise', async () => {
    const h = await harness();
    const result = await h.service.getContent(ORG, '"stale"');
    expect(result.manifest?.contentVersion).toBeDefined();
    expect(result.etag).toBe(`"${result.manifest!.contentVersion}"`);
  });

  it('changes the ETag when the IndexNow key is set', () => {
    expect(manifestEtag('v', KEY)).not.toBe(manifestEtag('v', null));
    expect(manifestEtag('v', null)).toBe('"v"');
  });
});

describe('SiteService.getMedia', () => {
  it('serves a rendition of a published project with its sha256', async () => {
    const { service } = await harness();
    for (const rendition of ['master', 'card4x3', 'hero16x9', 'og-branded'] as const) {
      const file = await service.getMedia(ORG, PH_PUB, rendition);
      expect(file.contentType).toBe('image/jpeg');
      expect(file.sha256).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it('is a 404 for a photo of an unpublished project and for an unknown photo', async () => {
    const { service } = await harness();
    await expect(service.getMedia(ORG, PH_DRAFT, 'master')).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.getMedia(ORG, '00000000-0000-4000-8000-0000000000ff', 'master')).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('SiteService.recordBuild', () => {
  it('writes the state, then emits the event and requests the ping, for live', async () => {
    const h = await harness();
    await h.service.recordBuild(ORG, { contentVersion: 'v9', status: 'live', durationMs: 4000 });
    expect(h.state[0]).toMatchObject({ lastBuildVersion: 'v9', lastBuildStatus: 'live', lastBuildError: null });
    expect(h.order).toEqual(['commit', 'live-event', 'ping']);
    expect(h.ping.requestPing).toHaveBeenCalledWith({ orgId: ORG, fromVersion: null, toVersion: 'v9' });
  });

  it('passes the previous build version as fromVersion', async () => {
    const h = await harness();
    await h.service.recordBuild(ORG, { contentVersion: 'v1', status: 'live', durationMs: 1 });
    await h.service.recordBuild(ORG, { contentVersion: 'v2', status: 'live', durationMs: 1 });
    expect(h.ping.requestPing).toHaveBeenLastCalledWith({ orgId: ORG, fromVersion: 'v1', toVersion: 'v2' });
  });

  it('records a failure and never pings', async () => {
    const h = await harness();
    await h.service.recordBuild(ORG, { contentVersion: 'v9', status: 'failed', durationMs: 10, error: 'astro build exited 1' });
    expect(h.state[0]).toMatchObject({ lastBuildStatus: 'failed', lastBuildError: 'astro build exited 1' });
    expect(h.order).toEqual(['commit', 'failed-event']);
    expect(h.ping.requestPing).not.toHaveBeenCalled();
  });

  it('still saves and still pings when the events seam throws', async () => {
    const h = await harness();
    h.events.publishBuildLive.mockImplementation(() => {
      throw new Error('boom');
    });
    await expect(h.service.recordBuild(ORG, { contentVersion: 'v9', status: 'live', durationMs: 1 })).resolves.toBeDefined();
    expect(h.ping.requestPing).toHaveBeenCalled();
  });
});
