// The projects, photos and publish services over an in-memory organization-scoped
// database (`fake-org-db.ts`): validation outcomes, cross-org 404, stale
// If-Match (412), delete of a published project (409), slug uniqueness (including
// previous slugs), reorder integrity, and the publish rules. The same flows
// against real PostgreSQL: `projects.db.spec.ts`.
import { BadRequestException, ConflictException, NotFoundException, PreconditionFailedException, UnprocessableEntityException } from '@nestjs/common';
import { Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';

import { PhotosService } from '../../src/projects/photos.service';
import { ProjectsService, parseIfMatch } from '../../src/projects/projects.service';
import { baseSlug, normalizeFileSlug } from '../../src/projects/projects.schemas';
import { SitePublishService } from '../../src/projects/site-publish.service';
import { FakeOrgDb } from './fake-org-db';

const ORG = '11111111-1111-4111-8111-111111111111';
const OTHER_ORG = '99999999-9999-4999-8999-999999999999';
const USER = 'user-a';
const words = (n: number) => Array.from({ length: n }, (_, i) => `word${i}`).join(' ');

beforeAll(() => Logger.overrideLogger(false));

function build() {
  const db = new FakeOrgDb();
  const storage = {
    describe: jest.fn(),
    previewUrl: jest.fn().mockResolvedValue('https://signed.example.test/preview'),
    deleteAll: jest.fn().mockResolvedValue(undefined),
  };
  const events = { publishPublished: jest.fn(), publishUnpublished: jest.fn() };
  const processing = { enqueue: jest.fn() };
  const site = new SitePublishService(db.prisma as never, events as never);
  const projects = new ProjectsService(db.prisma as never, storage as never, site);
  const photos = new PhotosService(db.prisma as never, storage as never, processing as never, site);
  return { db, storage, events, processing, site, projects, photos };
}
type Ctx = ReturnType<typeof build>;

/** A draft project that passes the SEO lint once it has a ready cover photo. */
function seedProject(db: FakeOrgDb, extra: Record<string, unknown> = {}): Record<string, any> {
  const row = {
    id: randomUUID(), orgId: ORG, slug: 'drywall-repair-conroe', previousSlugs: [], status: 'draft', title: 'Drywall repair in Conroe, TX',
    serviceSlug: 'drywall-repair', townSlug: 'conroe', workNotes: 'private notes', summary: '', body: words(160),
    seoTitle: 'Drywall Repair in Conroe TX | Quality Patch Work',
    metaDescription: 'See how we repaired a water damaged ceiling and wall in Conroe, with texture matched and paint blended.',
    completedOn: new Date('2026-05-10T00:00:00Z'), featured: false, coverPhotoId: null, publishedAt: null, version: 1,
    createdById: USER, updatedById: USER, createdAt: new Date('2026-01-01'), updatedAt: new Date('2026-01-01'), ...extra,
  };
  db.projects.push(row);
  return row;
}
function seedPhoto(db: FakeOrgDb, projectId: string, extra: Record<string, unknown> = {}): Record<string, any> {
  const row = {
    id: randomUUID(), orgId: ORG, projectId, sortOrder: db.photos.filter((p) => p.projectId === projectId).length, role: 'after', originalObjectId: randomUUID(),
    enhancedObjectId: null, retouchedObjectId: null, chosenVariant: 'enhanced', renditions: null, focalX: 0.5, focalY: 0.5, width: 800, height: 600,
    dominantColor: null, altText: 'A patched drywall wall after sanding', caption: 'Finished wall', fileSlug: 'wall-patch', qualityFlags: [], privacyFlags: [],
    processingStatus: 'ready', processingError: null, aiRetouched: false, createdAt: new Date(), updatedAt: new Date(), ...extra,
  };
  db.photos.push(row);
  return row;
}
/** A project that can be published: valid fields and two ready photos, the first its cover. */
function seedPublishable(db: FakeOrgDb, extra: Record<string, unknown> = {}): Record<string, any> {
  const project = seedProject(db, extra);
  const cover = seedPhoto(db, project.id);
  seedPhoto(db, project.id);
  project.coverPhotoId = cover.id;
  return project;
}

describe('helpers', () => {
  it.each([
    ['3', 3],
    ['"3"', 3],
    ['W/"7"', 7],
  ])('parses If-Match %s', (header, version) => {
    expect(parseIfMatch(header)).toBe(version);
  });
  it.each([[undefined], [''], ['abc']])('rejects If-Match %p with 412', (header) => {
    expect(() => parseIfMatch(header as string | undefined)).toThrow(PreconditionFailedException);
  });
  it('builds slugs from a title or from service, town and month', () => {
    const now = new Date('2026-03-15T00:00:00Z');
    expect(baseSlug('Fixing a Deck: Conroe, TX!', 'decks', 'conroe', now)).toBe('fixing-a-deck-conroe-tx');
    expect(baseSlug(undefined, 'drywall-repair', 'conroe', now)).toBe('drywall-repair-conroe-2026-03');
    expect(baseSlug('!!', 'drywall-repair', 'conroe', now)).toBe('drywall-repair-conroe-2026-03');
    expect(baseSlug('a'.repeat(100), 'x', 'y', now)).toHaveLength(70);
  });
  it('normalises file slugs to [a-z0-9-], at most 60 characters', () => {
    expect(normalizeFileSlug('IMG 2041 (final).JPG')).toBe('img-2041-final-jpg');
    expect(normalizeFileSlug('x'.repeat(80))).toHaveLength(60);
    expect(normalizeFileSlug('---')).toBe('');
  });
});

describe('ProjectsService', () => {
  let ctx: Ctx;
  beforeEach(() => {
    ctx = build();
  });

  describe('create', () => {
    it('makes a draft in the caller organization with the audit fields, slug from the title', async () => {
      const view = await ctx.projects.create(ORG, USER, { serviceSlug: 'drywall-repair', townSlug: 'conroe', title: 'Ceiling patch in Conroe', workNotes: 'rough notes' });
      expect(view).toMatchObject({ status: 'draft', slug: 'ceiling-patch-in-conroe', createdById: USER, updatedById: USER, version: 1, workNotes: 'rough notes' });
      expect(ctx.db.projects[0]).toMatchObject({ orgId: ORG });
      expect(new Set(ctx.db.prisma.scopes)).toEqual(new Set([ORG])); // every query ran in the caller's organization scope
    });

    it('derives <service>-<town>-<yyyy-mm> without a title', async () => {
      jest.useFakeTimers({ now: new Date('2026-03-15T00:00:00Z'), doNotFake: ['nextTick', 'setImmediate', 'clearImmediate', 'setInterval', 'clearInterval', 'setTimeout', 'clearTimeout', 'queueMicrotask'] });
      try {
        expect((await ctx.projects.create(ORG, USER, { serviceSlug: 'drywall-repair', townSlug: 'conroe' })).slug).toBe('drywall-repair-conroe-2026-03');
      } finally {
        jest.useRealTimers();
      }
    });

    it('keeps slugs unique with -2, -3', async () => {
      const input = { serviceSlug: 'drywall-repair' as const, townSlug: 'conroe' as const, title: 'Same title here' };
      const slugs = [];
      for (let i = 0; i < 3; i++) slugs.push((await ctx.projects.create(ORG, USER, input)).slug);
      expect(slugs).toEqual(['same-title-here', 'same-title-here-2', 'same-title-here-3']);
    });

    it('skips a slug another project used before (previousSlugs)', async () => {
      seedProject(ctx.db, { slug: 'moved-elsewhere', previousSlugs: ['same-title-here'] });
      expect((await ctx.projects.create(ORG, USER, { serviceSlug: 'drywall-repair', townSlug: 'conroe', title: 'Same title here' })).slug).toBe('same-title-here-2');
    });

    it('does not collide with another organization (slugs are unique per organization)', async () => {
      seedProject(ctx.db, { orgId: OTHER_ORG, slug: 'same-title-here' });
      expect((await ctx.projects.create(ORG, USER, { serviceSlug: 'drywall-repair', townSlug: 'conroe', title: 'Same title here' })).slug).toBe('same-title-here');
    });

    it('retries when a concurrent insert takes the slug (unique violation), then gives up with 409', async () => {
      const unique = () => new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'test' });
      const create = jest.spyOn(ctx.db.tx.project, 'create');
      create.mockRejectedValueOnce(unique());
      await expect(ctx.projects.create(ORG, USER, { serviceSlug: 'drywall-repair', townSlug: 'conroe', title: 'Raced title one' })).resolves.toMatchObject({ slug: 'raced-title-one' });
      create.mockRejectedValue(unique());
      await expect(ctx.projects.create(ORG, USER, { serviceSlug: 'drywall-repair', townSlug: 'conroe', title: 'Raced title two' })).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('update', () => {
    it('applies a patch, bumps the version and records the editor', async () => {
      const project = seedProject(ctx.db);
      const view = await ctx.projects.update(ORG, 'user-b', project.id, { title: 'New title for the job', completedOn: '2026-06-01', featured: true }, '1');
      expect(view).toMatchObject({ title: 'New title for the job', version: 2, updatedById: 'user-b', completedOn: '2026-06-01', featured: true, createdById: USER });
    });

    it('answers 412 for a stale If-Match and changes nothing', async () => {
      const project = seedProject(ctx.db, { version: 3 });
      await expect(ctx.projects.update(ORG, USER, project.id, { title: 'Another title here' }, '2')).rejects.toBeInstanceOf(PreconditionFailedException);
      expect(ctx.db.projects[0]!.title).toBe('Drywall repair in Conroe, TX');
      expect(ctx.db.projects[0]!.version).toBe(3);
    });

    it('answers 412 without an If-Match header', async () => {
      const project = seedProject(ctx.db);
      await expect(ctx.projects.update(ORG, USER, project.id, { title: 'Another title here' }, undefined)).rejects.toBeInstanceOf(PreconditionFailedException);
    });

    it('answers 404 for another organization project and for an unknown id', async () => {
      const foreign = seedProject(ctx.db, { orgId: OTHER_ORG });
      await expect(ctx.projects.update(ORG, USER, foreign.id, { title: 'Taking over here' }, '1')).rejects.toBeInstanceOf(NotFoundException);
      await expect(ctx.projects.update(ORG, USER, randomUUID(), { title: 'Nothing here' }, '1')).rejects.toBeInstanceOf(NotFoundException);
      expect(ctx.db.projects[0]!.title).not.toBe('Taking over here');
    });

    it('remembers the old slug of a PUBLISHED project and not of a draft', async () => {
      const published = seedProject(ctx.db, { status: 'published', publishedAt: new Date(), slug: 'live-slug' });
      const draft = seedProject(ctx.db, { slug: 'draft-slug' });
      expect(await ctx.projects.update(ORG, USER, published.id, { slug: 'live-slug-v2' }, '1')).toMatchObject({ slug: 'live-slug-v2', previousSlugs: ['live-slug'] });
      expect(await ctx.projects.update(ORG, USER, draft.id, { slug: 'draft-slug-v2' }, '1')).toMatchObject({ slug: 'draft-slug-v2', previousSlugs: [] });
    });

    it('drops a previous slug when the project takes it back', async () => {
      const project = seedProject(ctx.db, { status: 'published', publishedAt: new Date(), slug: 'b-slug', previousSlugs: ['a-slug'] });
      expect(await ctx.projects.update(ORG, USER, project.id, { slug: 'a-slug' }, '1')).toMatchObject({ slug: 'a-slug', previousSlugs: ['b-slug'] });
    });

    it('answers 409 for a slug another project uses or used', async () => {
      seedProject(ctx.db, { slug: 'taken-slug', previousSlugs: ['old-slug'] });
      const project = seedProject(ctx.db, { slug: 'mine-slug' });
      await expect(ctx.projects.update(ORG, USER, project.id, { slug: 'taken-slug' }, '1')).rejects.toBeInstanceOf(ConflictException);
      await expect(ctx.projects.update(ORG, USER, project.id, { slug: 'old-slug' }, '1')).rejects.toBeInstanceOf(ConflictException);
    });

    it('accepts only photos of the project as the cover (400)', async () => {
      const project = seedProject(ctx.db);
      const other = seedProject(ctx.db, { slug: 'other-slug-here' });
      const foreignPhoto = seedPhoto(ctx.db, other.id);
      await expect(ctx.projects.update(ORG, USER, project.id, { coverPhotoId: foreignPhoto.id }, '1')).rejects.toBeInstanceOf(BadRequestException);
      const own = seedPhoto(ctx.db, project.id);
      expect(await ctx.projects.update(ORG, USER, project.id, { coverPhotoId: own.id }, '1')).toMatchObject({ coverPhotoId: own.id });
    });

    it('refuses to archive a published project (409) but archives a draft', async () => {
      const published = seedProject(ctx.db, { status: 'published', slug: 'live-one' });
      const draft = seedProject(ctx.db, { slug: 'draft-one' });
      await expect(ctx.projects.update(ORG, USER, published.id, { status: 'archived' }, '1')).rejects.toBeInstanceOf(ConflictException);
      expect(await ctx.projects.update(ORG, USER, draft.id, { status: 'archived' }, '1')).toMatchObject({ status: 'archived' });
    });

    it('recomputes the content version when a PUBLISHED project changes, and not for a draft', async () => {
      const live = seedPublishable(ctx.db);
      await ctx.site.publish(ORG, USER, live.id, 1);
      const before = ctx.db.state[0]!.contentVersion;
      const draft = seedProject(ctx.db, { slug: 'a-draft-one' });
      await ctx.projects.update(ORG, USER, draft.id, { body: 'unrelated draft edit' }, '1');
      expect(ctx.db.state[0]!.contentVersion).toBe(before);
      await ctx.projects.update(ORG, USER, live.id, { summary: 'A new public summary' }, '2');
      expect(ctx.db.state[0]!.contentVersion).not.toBe(before);
    });

    it('does not log the private work notes', async () => {
      const log = jest.spyOn((ctx.projects as unknown as { logger: { log: (m: string) => void } }).logger, 'log');
      const project = seedProject(ctx.db);
      await ctx.projects.update(ORG, USER, project.id, { workNotes: 'customer address 12 Example Street' }, '1');
      expect(log.mock.calls.flat().join(' ')).not.toContain('Example Street');
      expect(log.mock.calls.flat().join(' ')).toContain(`projectId=${project.id}`);
    });
  });

  describe('remove', () => {
    it('answers 409 for a published project', async () => {
      const project = seedProject(ctx.db, { status: 'published' });
      await expect(ctx.projects.remove(ORG, USER, project.id)).rejects.toBeInstanceOf(ConflictException);
      expect(ctx.db.projects).toHaveLength(1);
    });

    it.each(['draft', 'archived'])('deletes a %s project, its photos and their storage objects', async (status) => {
      const project = seedProject(ctx.db, { status });
      const photo = seedPhoto(ctx.db, project.id, { enhancedObjectId: randomUUID(), renditions: { thumb: { objectId: 'thumb-object', width: 1, height: 1 } } });
      await ctx.projects.remove(ORG, USER, project.id);
      expect(ctx.db.projects).toHaveLength(0);
      expect(ctx.db.photos).toHaveLength(0);
      const ids = ctx.storage.deleteAll.mock.calls[0]![0] as string[];
      expect(ids).toEqual(expect.arrayContaining([photo.originalObjectId, photo.enhancedObjectId, 'thumb-object']));
      expect(ctx.storage.deleteAll.mock.calls[0]!.slice(1)).toEqual([USER, ORG]);
    });

    it('answers 404 across organizations and deletes nothing', async () => {
      const project = seedProject(ctx.db, { orgId: OTHER_ORG });
      await expect(ctx.projects.remove(ORG, USER, project.id)).rejects.toBeInstanceOf(NotFoundException);
      expect(ctx.storage.deleteAll).not.toHaveBeenCalled();
    });
  });

  describe('list and get', () => {
    it('filters by status, service and text and paginates, newest first', async () => {
      for (let i = 0; i < 5; i++) seedProject(ctx.db, { slug: `job-${i}-slug`, title: `Job number ${i}`, status: i % 2 ? 'published' : 'draft', serviceSlug: i < 2 ? 'drywall-repair' : 'decks' });
      seedProject(ctx.db, { orgId: OTHER_ORG, slug: 'foreign-one', title: 'Job number foreign' });
      const all = await ctx.projects.list(ORG, USER, { page: 1, pageSize: 2 });
      expect(all).toMatchObject({ total: 5, totalPages: 3, page: 1, pageSize: 2 });
      expect(all.items).toHaveLength(2);
      expect((await ctx.projects.list(ORG, USER, { page: 3, pageSize: 2 })).items).toHaveLength(1);
      expect((await ctx.projects.list(ORG, USER, { page: 1, pageSize: 20, status: 'published' })).total).toBe(2);
      expect((await ctx.projects.list(ORG, USER, { page: 1, pageSize: 20, service: 'drywall-repair' })).total).toBe(2);
      expect((await ctx.projects.list(ORG, USER, { page: 1, pageSize: 20, q: 'NUMBER 3' })).items.map((p) => p.slug)).toEqual(['job-3-slug']);
    });

    it('returns the project with sorted photos, previews and the lint result', async () => {
      const project = seedPublishable(ctx.db, { body: 'short' });
      ctx.db.photos[0]!.sortOrder = 5;
      ctx.db.photos[1]!.sortOrder = 1;
      const view = await ctx.projects.get(ORG, USER, project.id);
      expect(view.photos.map((p) => p.sortOrder)).toEqual([1, 5]);
      expect(view.photos[0]!.previews).toMatchObject({ original: 'https://signed.example.test/preview' });
      expect(view.lint.errors.map((e) => e.code)).toContain('body.missing');
    });

    it('answers 404 for another organization project', async () => {
      const project = seedProject(ctx.db, { orgId: OTHER_ORG });
      await expect(ctx.projects.get(ORG, USER, project.id)).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  it('exposes the catalog', () => {
    expect(ctx.projects.catalog().services.length).toBeGreaterThan(0);
  });
});

describe('PhotosService', () => {
  let ctx: Ctx;
  beforeEach(() => {
    ctx = build();
  });
  const ready = { id: 'obj', name: 'IMG 2041.JPG', status: 'ready', mimeType: 'image/jpeg' };

  describe('add', () => {
    it.each([
      ['an unknown or foreign object', null],
      ['an object that is not ready', { ...ready, status: 'processing' }],
      ['an object that is not an image', { ...ready, mimeType: 'application/pdf' }],
    ])('answers 422 for %s', async (_label, object) => {
      ctx.storage.describe.mockResolvedValue(object);
      const project = seedProject(ctx.db);
      await expect(ctx.photos.add(ORG, USER, project.id, { storageObjectId: randomUUID() })).rejects.toBeInstanceOf(UnprocessableEntityException);
      expect(ctx.db.photos).toHaveLength(0);
      expect(ctx.processing.enqueue).not.toHaveBeenCalled();
    });

    it('creates a pending photo in order, with a file slug, and enqueues processing after the commit', async () => {
      const project = seedProject(ctx.db);
      ctx.storage.describe.mockResolvedValue(ready);
      const first = await ctx.photos.add(ORG, USER, project.id, { storageObjectId: randomUUID(), role: 'before' });
      const second = await ctx.photos.add(ORG, USER, project.id, { storageObjectId: randomUUID() });
      expect([first.sortOrder, second.sortOrder]).toEqual([0, 1]);
      expect(first).toMatchObject({ processingStatus: 'pending', role: 'before', fileSlug: 'img-2041' });
      expect(second.role).toBe('progress');
      expect(ctx.processing.enqueue).toHaveBeenCalledWith({ orgId: ORG, projectId: project.id, photoId: first.id, userId: USER }, ['analyze', 'enhance', 'crops']);
      expect(ctx.db.projects[0]!.coverPhotoId).toBe(second.id); // a before photo never becomes the cover on its own
    });

    it('answers 409 for an object already attached, and 404 for another organization project', async () => {
      const project = seedProject(ctx.db);
      ctx.storage.describe.mockResolvedValue(ready);
      const objectId = randomUUID();
      await ctx.photos.add(ORG, USER, project.id, { storageObjectId: objectId });
      await expect(ctx.photos.add(ORG, USER, project.id, { storageObjectId: objectId })).rejects.toBeInstanceOf(ConflictException);
      const foreign = seedProject(ctx.db, { orgId: OTHER_ORG, slug: 'foreign-slug' });
      await expect(ctx.photos.add(ORG, USER, foreign.id, { storageObjectId: randomUUID() })).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('update', () => {
    it('edits the text fields and normalises the file slug', async () => {
      const project = seedProject(ctx.db);
      const photo = seedPhoto(ctx.db, project.id);
      const view = await ctx.photos.update(ORG, USER, project.id, photo.id, { altText: 'Sanded patch on a living room wall', fileSlug: 'Living Room Wall!' });
      expect(view).toMatchObject({ altText: 'Sanded patch on a living room wall', fileSlug: 'living-room-wall' });
      expect(ctx.processing.enqueue).not.toHaveBeenCalled();
    });

    it('re-enqueues the crops only when the focal point changes', async () => {
      const project = seedProject(ctx.db);
      const photo = seedPhoto(ctx.db, project.id);
      await ctx.photos.update(ORG, USER, project.id, photo.id, { focalX: 0.5 });
      expect(ctx.processing.enqueue).not.toHaveBeenCalled();
      await ctx.photos.update(ORG, USER, project.id, photo.id, { focalX: 0.2, focalY: 0.7 });
      expect(ctx.processing.enqueue).toHaveBeenCalledWith({ orgId: ORG, projectId: project.id, photoId: photo.id, userId: USER }, ['crops']);
    });

    it('allows the retouched variant only with a retouched image and not on a before photo (422)', async () => {
      const project = seedProject(ctx.db);
      const plain = seedPhoto(ctx.db, project.id);
      const retouched = seedPhoto(ctx.db, project.id, { retouchedObjectId: randomUUID() });
      const before = seedPhoto(ctx.db, project.id, { retouchedObjectId: randomUUID(), role: 'before' });
      await expect(ctx.photos.update(ORG, USER, project.id, plain.id, { chosenVariant: 'retouched' })).rejects.toBeInstanceOf(UnprocessableEntityException);
      await expect(ctx.photos.update(ORG, USER, project.id, before.id, { chosenVariant: 'retouched' })).rejects.toBeInstanceOf(UnprocessableEntityException);
      expect(await ctx.photos.update(ORG, USER, project.id, retouched.id, { chosenVariant: 'retouched' })).toMatchObject({ chosenVariant: 'retouched' });
      await expect(ctx.photos.update(ORG, USER, project.id, retouched.id, { role: 'before' })).rejects.toBeInstanceOf(UnprocessableEntityException);
    });

    it('answers 404 for a photo of another project or organization', async () => {
      const project = seedProject(ctx.db);
      const other = seedProject(ctx.db, { slug: 'other-project' });
      const photo = seedPhoto(ctx.db, other.id);
      await expect(ctx.photos.update(ORG, USER, project.id, photo.id, { caption: 'Nope' })).rejects.toBeInstanceOf(NotFoundException);
      const foreign = seedProject(ctx.db, { orgId: OTHER_ORG, slug: 'foreign-slug' });
      const foreignPhoto = seedPhoto(ctx.db, foreign.id, { orgId: OTHER_ORG });
      await expect(ctx.photos.update(ORG, USER, foreign.id, foreignPhoto.id, { caption: 'Nope' })).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('remove', () => {
    it('deletes the row and its storage objects and clears the cover', async () => {
      const project = seedProject(ctx.db);
      const photo = seedPhoto(ctx.db, project.id, { enhancedObjectId: randomUUID() });
      project.coverPhotoId = photo.id;
      await ctx.photos.remove(ORG, USER, project.id, photo.id);
      expect(ctx.db.photos).toHaveLength(0);
      expect(ctx.db.projects[0]!.coverPhotoId).toBeNull();
      expect(ctx.storage.deleteAll).toHaveBeenCalledWith(expect.arrayContaining([photo.originalObjectId, photo.enhancedObjectId]), USER, ORG);
    });

    it('answers 404 for an unknown photo', async () => {
      const project = seedProject(ctx.db);
      await expect(ctx.photos.remove(ORG, USER, project.id, randomUUID())).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('reorder', () => {
    it('applies the order', async () => {
      const project = seedProject(ctx.db);
      const [a, b, c] = [seedPhoto(ctx.db, project.id), seedPhoto(ctx.db, project.id), seedPhoto(ctx.db, project.id)];
      const result = await ctx.photos.reorder(ORG, USER, project.id, { photoIds: [c.id, a.id, b.id] });
      expect(result.map((p) => p.id)).toEqual([c.id, a.id, b.id]);
      expect(result.map((p) => p.sortOrder)).toEqual([0, 1, 2]);
    });

    it.each([
      ['a missing id', (ids: string[]) => ids.slice(1)],
      ['an extra id', (ids: string[]) => [...ids, randomUUID()]],
      ['a repeated id', (ids: string[]) => [ids[0]!, ids[0]!, ids[2]!]],
      ['a foreign id', (ids: string[]) => [ids[0]!, ids[1]!, randomUUID()]],
    ])('answers 400 for %s and changes nothing', async (_label, mutate) => {
      const project = seedProject(ctx.db);
      const photos = [seedPhoto(ctx.db, project.id), seedPhoto(ctx.db, project.id), seedPhoto(ctx.db, project.id)];
      await expect(ctx.photos.reorder(ORG, USER, project.id, { photoIds: mutate(photos.map((p) => p.id)) })).rejects.toBeInstanceOf(BadRequestException);
      expect(ctx.db.photos.map((p) => p.sortOrder)).toEqual([0, 1, 2]);
    });

    it('answers 404 for another organization project', async () => {
      const foreign = seedProject(ctx.db, { orgId: OTHER_ORG });
      await expect(ctx.photos.reorder(ORG, USER, foreign.id, { photoIds: [randomUUID()] })).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});

describe('SitePublishService', () => {
  let ctx: Ctx;
  beforeEach(() => {
    ctx = build();
  });

  it('answers 422 listing the lint error codes, and publishes nothing', async () => {
    const project = seedProject(ctx.db, { title: '', body: 'too short' });
    const error = await ctx.site.publish(ORG, USER, project.id, 1).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(UnprocessableEntityException);
    const response = (error as UnprocessableEntityException).getResponse() as { details: { errors: Array<{ code: string }> } };
    expect(response.details.errors.map((e) => e.code)).toEqual(expect.arrayContaining(['title.missing', 'body.missing', 'cover.missing']));
    expect(ctx.db.projects[0]).toMatchObject({ status: 'draft', publishedAt: null, version: 1 });
    expect(ctx.db.state).toHaveLength(0);
    expect(ctx.events.publishPublished).not.toHaveBeenCalled();
  });

  it('publishes a clean project: status, publishedAt, version, content version and the event', async () => {
    const project = seedPublishable(ctx.db);
    const view = await ctx.site.publish(ORG, USER, project.id, 1);
    expect(view).toMatchObject({ status: 'published', version: 2, updatedById: USER });
    expect(view.publishedAt).toBeInstanceOf(Date);
    expect(view.contentVersion).toMatch(/^[0-9a-f]{64}$/);
    expect(ctx.db.state).toEqual([expect.objectContaining({ orgId: ORG, contentVersion: view.contentVersion })]);
    expect(ctx.events.publishPublished).toHaveBeenCalledWith({ orgId: ORG, projectId: project.id, slug: project.slug, actorUserId: USER });
  });

  it('answers 412 for a stale version, 404 across organizations, 409 for an archived project', async () => {
    const project = seedPublishable(ctx.db, { version: 4 });
    await expect(ctx.site.publish(ORG, USER, project.id, 3)).rejects.toBeInstanceOf(PreconditionFailedException);
    const foreign = seedProject(ctx.db, { orgId: OTHER_ORG, slug: 'foreign-slug' });
    await expect(ctx.site.publish(ORG, USER, foreign.id, 1)).rejects.toBeInstanceOf(NotFoundException);
    const archived = seedPublishable(ctx.db, { status: 'archived', slug: 'archived-slug' });
    await expect(ctx.site.publish(ORG, USER, archived.id, 1)).rejects.toBeInstanceOf(ConflictException);
  });

  it('refuses a duplicate title among published projects', async () => {
    const first = seedPublishable(ctx.db);
    await ctx.site.publish(ORG, USER, first.id, 1);
    const second = seedPublishable(ctx.db, { slug: 'second-slug-here' });
    const error = await ctx.site.publish(ORG, USER, second.id, 1).catch((e: unknown) => e);
    const codes = ((error as UnprocessableEntityException).getResponse() as { details: { errors: Array<{ code: string }> } }).details.errors.map((e) => e.code);
    expect(codes).toEqual(expect.arrayContaining(['title.duplicate', 'meta.duplicate']));
  });

  it('keeps publishedAt when a project is published again', async () => {
    const project = seedPublishable(ctx.db);
    const first = await ctx.site.publish(ORG, USER, project.id, 1);
    await ctx.site.unpublish(ORG, USER, project.id, undefined);
    const again = await ctx.site.publish(ORG, USER, project.id, 3);
    expect(again.publishedAt).toEqual(first.publishedAt);
  });

  it('unpublish returns the project to draft, recomputes the version and emits the event; 409 when not published', async () => {
    const project = seedPublishable(ctx.db);
    const published = await ctx.site.publish(ORG, USER, project.id, 1);
    const view = await ctx.site.unpublish(ORG, USER, project.id, 2);
    expect(view.status).toBe('draft');
    expect(view.contentVersion).not.toBe(published.contentVersion);
    expect(ctx.events.publishUnpublished).toHaveBeenCalledTimes(1);
    await expect(ctx.site.unpublish(ORG, USER, project.id, undefined)).rejects.toBeInstanceOf(ConflictException);
    const stale = seedPublishable(ctx.db, { status: 'published', slug: 'stale-slug' });
    await expect(ctx.site.unpublish(ORG, USER, stale.id, 9)).rejects.toBeInstanceOf(PreconditionFailedException);
  });

  it('changes the content version only when published content changes', async () => {
    const live = seedPublishable(ctx.db);
    const published = await ctx.site.publish(ORG, USER, live.id, 1);
    const stateAfterPublish = { ...ctx.db.state[0]! };
    // An unrelated draft: created, edited, given photos. Nothing public changed.
    const draft = seedPublishable(ctx.db, { slug: 'draft-two', title: 'A different draft title here' });
    await new ProjectsService(ctx.db.prisma as never, ctx.storage as never, ctx.site).update(ORG, USER, draft.id, { body: 'only a draft changed' }, '1');
    expect(ctx.db.state[0]).toEqual(stateAfterPublish);
    // The published project's chosen rendition changes: the version moves.
    ctx.db.photos.find((p) => p.projectId === live.id)!.enhancedObjectId = randomUUID();
    const { contentVersion } = await ctx.db.prisma.runInOrg(ORG, (tx) => ctx.site.recompute(tx, ORG));
    expect(contentVersion).not.toBe(published.contentVersion);
  });
});
