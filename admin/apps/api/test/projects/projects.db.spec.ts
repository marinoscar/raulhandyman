// The projects flows against real PostgreSQL, row-level security in force
// (POSTGRES_USER is an ordinary role): slug uniqueness under concurrency and
// across previous slugs, optimistic concurrency, organization isolation,
// publish / unpublish and the content version stored in `site_publish_state`.
import { ConflictException, Logger, NotFoundException, PreconditionFailedException, UnprocessableEntityException } from '@nestjs/common';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { randomUUID } from 'node:crypto';

import { createApp } from '../../src/main';
import { PrismaService } from '../../src/prisma/prisma.service';
import { PrismaSystemService } from '../../src/prisma/prisma-system.service';
import { PhotosService } from '../../src/projects/photos.service';
import { ProjectsService } from '../../src/projects/projects.service';
import { SitePublishService } from '../../src/projects/site-publish.service';

const run = `${Date.now()}`;
const words = (n: number) => Array.from({ length: n }, (_, i) => `word${i}`).join(' ');

let app: NestFastifyApplication;
let prisma: PrismaService;
let system: PrismaSystemService;
let orgA: string;
let orgB: string;
let userId: string;
let projects: ProjectsService;
let photos: PhotosService;
let site: SitePublishService;
const storage = {
  describe: jest.fn(),
  previewUrl: jest.fn().mockResolvedValue(null),
  deleteAll: jest.fn().mockResolvedValue(undefined),
};
const events = { publishPublished: jest.fn(), publishUnpublished: jest.fn() };
const processing = { enqueue: jest.fn() };

beforeAll(async () => {
  Logger.overrideLogger(false);
  app = await createApp();
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  prisma = app.get(PrismaService);
  system = app.get(PrismaSystemService);
  orgA = (await system.runAsSystem('purge', (tx) => tx.organization.create({ data: { name: 'Org Alpha', slug: `projects-alpha-${run}` } }))).id;
  orgB = (await system.runAsSystem('purge', (tx) => tx.organization.create({ data: { name: 'Org Beta', slug: `projects-beta-${run}` } }))).id;
  userId = (await system.runAsSystem('purge', (tx) => tx.user.create({ data: { email: `person-a-${run}@example.test` } }))).id;
  site = new SitePublishService(prisma, events as never);
  projects = new ProjectsService(prisma, storage as never, site);
  photos = new PhotosService(prisma, storage as never, processing as never, site);
});

afterAll(async () => {
  await system?.runAsSystem('purge', async (tx) => {
    await tx.organization.deleteMany({ where: { id: { in: [orgA, orgB] } } });
    await tx.user.deleteMany({ where: { id: userId } });
  });
  await app?.close();
});

const input = (title: string) => ({ serviceSlug: 'drywall-repair' as const, townSlug: 'conroe' as const, title });

/** Makes a project publishable: valid text and two ready photos with alt text, the first the cover. */
async function makePublishable(orgId: string, title: string) {
  const created = await projects.create(orgId, userId, input(title));
  await prisma.runInOrg(orgId, async (tx) => {
    const cover = await tx.projectPhoto.create({
      data: { orgId, projectId: created.id, role: 'after', originalObjectId: randomUUID(), altText: 'A patched drywall wall after sanding', caption: 'Done', processingStatus: 'ready', sortOrder: 0 },
    });
    await tx.projectPhoto.create({
      data: { orgId, projectId: created.id, role: 'before', originalObjectId: randomUUID(), altText: 'The damaged drywall wall before repair', caption: 'Before', processingStatus: 'ready', sortOrder: 1 },
    });
    await tx.project.update({
      where: { id: created.id },
      data: {
        body: words(160),
        seoTitle: `Drywall Repair in Conroe TX | ${title}`.slice(0, 60).padEnd(32, '.'),
        metaDescription: `See how we repaired a damaged wall for ${title} in Conroe, with texture matched and paint blended in.`.slice(0, 150),
        completedOn: new Date('2026-05-10T00:00:00Z'),
        coverPhotoId: cover.id,
      },
    });
  });
  return projects.get(orgId, userId, created.id);
}

const contentVersion = (orgId: string) => prisma.runInOrg(orgId, (tx) => tx.sitePublishState.findFirst());

describe('slugs', () => {
  it('numbers duplicates -2, -3 against the real unique index', async () => {
    const slugs = [];
    for (let i = 0; i < 3; i++) slugs.push((await projects.create(orgA, userId, input('Seq slug title'))).slug);
    expect(slugs).toEqual(['seq-slug-title', 'seq-slug-title-2', 'seq-slug-title-3']);
  });

  it('gives concurrent creates distinct slugs (the unique violation is retried)', async () => {
    const results = await Promise.all(Array.from({ length: 6 }, () => projects.create(orgA, userId, input('Concurrent slug title'))));
    expect(new Set(results.map((p) => p.slug)).size).toBe(6);
  });

  it('is unique per organization, so another organization may reuse a slug', async () => {
    expect((await projects.create(orgB, userId, input('Seq slug title'))).slug).toBe('seq-slug-title');
  });

  it('refuses a slug used by a previous slug of another project, and numbers around it', async () => {
    const published = await makePublishable(orgA, 'Renamed slug project');
    await site.publish(orgA, userId, published.id, published.version);
    const live = await projects.get(orgA, userId, published.id);
    const renamed = await projects.update(orgA, userId, published.id, { slug: 'renamed-slug-project-new' }, String(live.version));
    expect(renamed.previousSlugs).toEqual([published.slug]);
    const other = await projects.create(orgA, userId, input('Another project here'));
    await expect(projects.update(orgA, userId, other.id, { slug: published.slug }, '1')).rejects.toBeInstanceOf(ConflictException);
    expect((await projects.create(orgA, userId, input('Renamed slug project'))).slug).toBe('renamed-slug-project-2');
  });
});

describe('optimistic concurrency and isolation', () => {
  it('answers 412 to a stale If-Match and applies a current one', async () => {
    const project = await projects.create(orgA, userId, input('Concurrency project'));
    expect((await projects.update(orgA, userId, project.id, { title: 'Concurrency project edited' }, '1')).version).toBe(2);
    await expect(projects.update(orgA, userId, project.id, { title: 'Stale write here' }, '1')).rejects.toBeInstanceOf(PreconditionFailedException);
  });

  it('keeps one organization from reading, editing, publishing or deleting the other projects (404)', async () => {
    const project = await projects.create(orgA, userId, input('Isolated project'));
    await expect(projects.get(orgB, userId, project.id)).rejects.toBeInstanceOf(NotFoundException);
    await expect(projects.update(orgB, userId, project.id, { title: 'Hijacked title here' }, '1')).rejects.toBeInstanceOf(NotFoundException);
    await expect(site.publish(orgB, userId, project.id, 1)).rejects.toBeInstanceOf(NotFoundException);
    await expect(projects.remove(orgB, userId, project.id)).rejects.toBeInstanceOf(NotFoundException);
    expect((await projects.list(orgB, userId, { page: 1, pageSize: 100 })).items.map((p) => p.id)).not.toContain(project.id);
  });
});

describe('photos', () => {
  it('adds, reorders and deletes a photo with real foreign keys', async () => {
    storage.describe.mockResolvedValue({ id: 'x', name: 'wall.jpg', status: 'ready', mimeType: 'image/jpeg' });
    const project = await projects.create(orgA, userId, input('Photo project here'));
    const first = await photos.add(orgA, userId, project.id, { storageObjectId: randomUUID(), role: 'after' });
    const second = await photos.add(orgA, userId, project.id, { storageObjectId: randomUUID() });
    expect(processing.enqueue).toHaveBeenCalledTimes(2);
    expect((await projects.get(orgA, userId, project.id)).coverPhotoId).toBe(first.id);
    const reordered = await photos.reorder(orgA, userId, project.id, { photoIds: [second.id, first.id] });
    expect(reordered.map((p) => p.id)).toEqual([second.id, first.id]);
    await photos.remove(orgA, userId, project.id, first.id);
    const after = await projects.get(orgA, userId, project.id);
    expect(after.photos.map((p) => p.id)).toEqual([second.id]);
    expect(after.coverPhotoId).toBeNull();
  });

  it('deleting a project deletes its photos (cascade) and asks storage to delete the objects', async () => {
    storage.deleteAll.mockClear();
    storage.describe.mockResolvedValue({ id: 'x', name: 'a.jpg', status: 'ready', mimeType: 'image/png' });
    const project = await projects.create(orgA, userId, input('Doomed project here'));
    const photo = await photos.add(orgA, userId, project.id, { storageObjectId: randomUUID() });
    await projects.remove(orgA, userId, project.id);
    expect(await prisma.runInOrg(orgA, (tx) => tx.projectPhoto.count({ where: { id: photo.id } }))).toBe(0);
    expect(storage.deleteAll).toHaveBeenCalledWith([photo.originalObjectId], userId, orgA);
  });
});

describe('publish and the content version', () => {
  it('refuses to publish a project with SEO errors (422) and writes no version', async () => {
    const project = await projects.create(orgB, userId, input('Not ready project'));
    await expect(site.publish(orgB, userId, project.id, project.version)).rejects.toBeInstanceOf(UnprocessableEntityException);
    expect(await contentVersion(orgB)).toBeNull();
  });

  it('publishes, moves the version with published content only, and unpublishes', async () => {
    const draftOnly = await projects.create(orgB, userId, input('Unrelated draft project'));
    const project = await makePublishable(orgB, 'Publishable flow project');
    const published = await site.publish(orgB, userId, project.id, project.version);
    expect(published.status).toBe('published');
    expect(published.publishedAt).toBeInstanceOf(Date);
    const state1 = await contentVersion(orgB);
    expect(state1?.contentVersion).toBe(published.contentVersion);
    expect(state1?.lastPublishedAt).toBeInstanceOf(Date);

    // An unrelated draft edit leaves the version alone.
    await projects.update(orgB, userId, draftOnly.id, { body: 'only a draft changed' }, '1');
    expect((await contentVersion(orgB))?.contentVersion).toBe(state1?.contentVersion);

    // Editing the published project moves it.
    await projects.update(orgB, userId, project.id, { summary: 'A new public summary' }, String(published.version));
    const state2 = await contentVersion(orgB);
    expect(state2?.contentVersion).not.toBe(state1?.contentVersion);

    // Unpublishing removes it from the manifest.
    const current = await projects.get(orgB, userId, project.id);
    const draft = await site.unpublish(orgB, userId, project.id, current.version);
    expect(draft.status).toBe('draft');
    expect((await contentVersion(orgB))?.contentVersion).not.toBe(state2?.contentVersion);
    expect(events.publishPublished).toHaveBeenCalled();
    expect(events.publishUnpublished).toHaveBeenCalled();
  });

  it('refuses to delete a published project (409) until it is unpublished', async () => {
    const project = await makePublishable(orgA, 'Delete guard project');
    const published = await site.publish(orgA, userId, project.id, project.version);
    await expect(projects.remove(orgA, userId, project.id)).rejects.toBeInstanceOf(ConflictException);
    await site.unpublish(orgA, userId, project.id, published.version);
    await expect(projects.remove(orgA, userId, project.id)).resolves.toBeUndefined();
  });

  it('refuses a published title another published project already uses (422)', async () => {
    const first = await makePublishable(orgA, 'Duplicate title project');
    await site.publish(orgA, userId, first.id, first.version);
    const second = await makePublishable(orgA, 'Duplicate title project');
    await expect(site.publish(orgA, userId, second.id, second.version)).rejects.toBeInstanceOf(UnprocessableEntityException);
  });
});
