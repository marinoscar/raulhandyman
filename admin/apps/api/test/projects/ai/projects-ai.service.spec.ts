// The enqueue and apply logic of the AI routes over the in-memory organization
// database of the other projects specs (`../fake-org-db.ts`).
import { ConflictException, Logger, NotFoundException, PreconditionFailedException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';

import { RETOUCH_NOT_ALLOWED } from '../../../src/projects/ai/projects-ai.errors';
import { applyBodySchema, regenerateBodySchema, retouchBodySchema, suggestBodySchema } from '../../../src/projects/ai/projects-ai.schemas';
import { ProjectsAiService } from '../../../src/projects/ai/projects-ai.service';
import { SitePublishService } from '../../../src/projects/site-publish.service';
import { FakeOrgDb } from '../fake-org-db';

const ORG = '11111111-1111-4111-8111-111111111111';
const USER = 'user-a';
beforeAll(() => Logger.overrideLogger(false));

function build() {
  const db = new FakeOrgDb();
  const jobs = { enqueue: jest.fn(async (input: any) => ({ id: `job-${jobs.enqueue.mock.calls.length}`, ...input })) };
  const prisma = Object.assign(db.prisma, { job: { findFirst: jest.fn().mockResolvedValue(null) } });
  const storage = { deleteAll: jest.fn().mockResolvedValue(undefined) };
  const site = new SitePublishService(db.prisma as never, { publishPublished: jest.fn(), publishUnpublished: jest.fn() } as never);
  const service = new ProjectsAiService(prisma as never, jobs as never, site, storage as never);
  return { db, jobs, prisma, storage, service };
}
type Ctx = ReturnType<typeof build>;

const suggestion = (output: Record<string, unknown>) => ({ model: 'fake-model', createdAt: '2026-01-01T00:00:00.000Z', runId: 'run-1', output });
const PROJECT_OUTPUT = {
  titleOptions: ['Hallway drywall patch in Conroe', 'Patched and blended hallway wall', 'Drywall hole repair with texture'],
  slug: 'hallway-drywall-patch-conroe',
  seoTitle: 'Drywall Patch in Conroe, TX',
  metaDescription: 'A hallway drywall hole patched and textured to match the wall. Ask for a free estimate today.',
  summary: 'A hole patched and blended.',
  body: 'New body text.',
  warnings: [],
};

function seedProject(db: FakeOrgDb, extra: Record<string, unknown> = {}): Record<string, any> {
  const row = {
    id: randomUUID(), orgId: ORG, slug: 'old-slug-conroe', previousSlugs: [], status: 'draft', title: 'Old title', serviceSlug: 'drywall-repair', townSlug: 'conroe',
    workNotes: 'notes', summary: 'Old summary', body: 'Old body', seoTitle: 'Old seo title', metaDescription: 'Old meta description',
    completedOn: null, featured: false, coverPhotoId: null, publishedAt: null, version: 3, aiSuggestion: null, createdById: USER, updatedById: USER,
    createdAt: new Date(), updatedAt: new Date(), ...extra,
  };
  db.projects.push(row);
  return row;
}
function seedPhoto(db: FakeOrgDb, projectId: string, extra: Record<string, unknown> = {}): Record<string, any> {
  const row = {
    id: randomUUID(), orgId: ORG, projectId, sortOrder: 0, role: 'after', originalObjectId: randomUUID(), enhancedObjectId: randomUUID(), retouchedObjectId: null,
    chosenVariant: 'enhanced', renditions: null, focalX: 0.5, focalY: 0.5, width: 800, height: 600, altText: 'Old alt', caption: 'Old caption', fileSlug: 'old-file',
    qualityFlags: [], privacyFlags: [], processingStatus: 'ready', processingError: null, aiRetouched: false, aiSuggestion: null, createdAt: new Date(), updatedAt: new Date(), ...extra,
  };
  db.photos.push(row);
  return row;
}

describe('request bodies', () => {
  it('suggest: everything optional', () => {
    expect(suggestBodySchema.parse({})).toEqual({});
    expect(() => suggestBodySchema.parse({ fields: ['everything'] })).toThrow();
  });
  it('apply: needs project fields or photos', () => {
    expect(() => applyBodySchema.parse({})).toThrow();
    expect(() => applyBodySchema.parse({ project: ['title'], titleOption: 3 })).toThrow();
    expect(applyBodySchema.parse({ project: ['title'], titleOption: 2 }).titleOption).toBe(2);
  });
  it('regenerate: a photo field needs photoId and a project field must not carry one', () => {
    const photo = randomUUID();
    expect(regenerateBodySchema.parse({ field: 'title' })).toEqual({ field: 'title' });
    expect(regenerateBodySchema.parse({ field: 'altText', photoId: photo })).toEqual({ field: 'altText', photoId: photo });
    expect(() => regenerateBodySchema.parse({ field: 'altText' })).toThrow();
    expect(() => regenerateBodySchema.parse({ field: 'title', photoId: photo })).toThrow();
    expect(() => regenerateBodySchema.parse({ field: 'slug' })).toThrow();
  });
  it('retouch: every option defaults to true and one must stay on', () => {
    expect(retouchBodySchema.parse(undefined).options).toEqual({ declutter: true, evenLighting: true, straighten: true });
    expect(retouchBodySchema.parse({ options: { straighten: false } }).options).toEqual({ declutter: true, evenLighting: true, straighten: false });
    expect(() => retouchBodySchema.parse({ options: { declutter: false, evenLighting: false, straighten: false } })).toThrow();
  });
});

describe('POST ai/suggest', () => {
  it('enqueues one job per project and returns its id', async () => {
    const t = build();
    const project = seedProject(t.db);
    const result = await t.service.suggest(ORG, USER, project.id, {});
    expect(result).toEqual({ jobId: 'job-1' });
    expect(t.jobs.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'projects.ai.suggest', subjectType: 'project', subjectId: project.id, orgId: ORG, payload: { orgId: ORG, projectId: project.id, userId: USER, fields: ['project', 'photos'] } }),
    );
  });

  it('answers 409 while a suggest job of the project is queued or running', async () => {
    const t = build();
    const project = seedProject(t.db);
    t.prisma.job.findFirst.mockResolvedValueOnce({ id: 'running' });
    await expect(t.service.suggest(ORG, USER, project.id, {})).rejects.toBeInstanceOf(ConflictException);
    expect(t.jobs.enqueue).not.toHaveBeenCalled();
    const dedup = t.prisma.job.findFirst.mock.calls[0]![0].where.dedupKey as string;
    expect(dedup).toContain('projects.ai.suggest');
    expect(dedup).toContain(project.id);
  });

  it('is a 404 for another organization and for a photo that is not the project\'s', async () => {
    const t = build();
    const project = seedProject(t.db);
    await expect(t.service.suggest('99999999-9999-4999-8999-999999999999', USER, project.id, {})).rejects.toBeInstanceOf(NotFoundException);
    await expect(t.service.suggest(ORG, USER, project.id, { photoIds: [randomUUID()] })).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('POST ai/regenerate', () => {
  it('enqueues a narrow run and asks for a different option than the current value and the stored one', async () => {
    const t = build();
    const project = seedProject(t.db, { seoTitle: 'Current seo', aiSuggestion: suggestion(PROJECT_OUTPUT) });
    await t.service.regenerate(ORG, USER, project.id, { field: 'seoTitle' });
    const payload = t.jobs.enqueue.mock.calls[0]![0].payload;
    expect(payload).toMatchObject({ fields: ['project'], regenerate: { field: 'seoTitle' } });
    expect(payload.regenerate.avoid).toBe('Current seo | Drywall Patch in Conroe, TX');
    expect(payload.photoIds).toBeUndefined();
  });

  it('narrows a photo field to that photo', async () => {
    const t = build();
    const project = seedProject(t.db);
    const photo = seedPhoto(t.db, project.id);
    await t.service.regenerate(ORG, USER, project.id, { field: 'caption', photoId: photo.id });
    expect(t.jobs.enqueue.mock.calls[0]![0].payload).toMatchObject({ fields: ['photos'], photoIds: [photo.id], regenerate: { field: 'caption', photoId: photo.id, avoid: 'Old caption' } });
  });

  it('answers 409 while a suggestion is running', async () => {
    const t = build();
    const project = seedProject(t.db);
    t.prisma.job.findFirst.mockResolvedValueOnce({ id: 'running' });
    await expect(t.service.regenerate(ORG, USER, project.id, { field: 'body' })).rejects.toBeInstanceOf(ConflictException);
  });
});

describe('POST photos/:photoId/retouch', () => {
  const OPTIONS = { declutter: true, evenLighting: true, straighten: true };

  it('is a 422 RETOUCH_NOT_ALLOWED for a before photo and enqueues nothing', async () => {
    const t = build();
    const project = seedProject(t.db);
    const photo = seedPhoto(t.db, project.id, { role: 'before' });
    const error = await t.service.retouch(ORG, USER, project.id, photo.id, OPTIONS).catch((e: any) => e);
    expect(error.getStatus()).toBe(422);
    expect(error.getResponse()).toMatchObject({ code: RETOUCH_NOT_ALLOWED });
    expect(t.jobs.enqueue).not.toHaveBeenCalled();
  });

  it('is a 409 until the photo is ready', async () => {
    const t = build();
    const project = seedProject(t.db);
    const photo = seedPhoto(t.db, project.id, { processingStatus: 'processing' });
    await expect(t.service.retouch(ORG, USER, project.id, photo.id, OPTIONS)).rejects.toBeInstanceOf(ConflictException);
  });

  it('enqueues the retouch job for an after photo', async () => {
    const t = build();
    const project = seedProject(t.db);
    const photo = seedPhoto(t.db, project.id);
    expect(await t.service.retouch(ORG, USER, project.id, photo.id, OPTIONS)).toEqual({ jobId: 'job-1' });
    expect(t.jobs.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'projects.photo.retouch', subjectType: 'project_photo', subjectId: photo.id, orgId: ORG, payload: { orgId: ORG, projectId: project.id, photoId: photo.id, userId: USER, options: OPTIONS } }),
    );
  });
});

describe('POST ai/apply', () => {
  it('copies only the asked-for fields, leaves the others alone and bumps the version', async () => {
    const t = build();
    const project = seedProject(t.db, { aiSuggestion: suggestion(PROJECT_OUTPUT) });
    const result = await t.service.apply(ORG, USER, project.id, { project: ['seoTitle', 'summary'] }, '3');
    expect(result).toMatchObject({ seoTitle: 'Drywall Patch in Conroe, TX', summary: 'A hole patched and blended.', title: 'Old title', body: 'Old body', metaDescription: 'Old meta description', slug: 'old-slug-conroe', version: 4 });
    expect(result.lint).toEqual(expect.objectContaining({ errors: expect.any(Array), warnings: expect.any(Array), score: expect.any(Number) }));
    expect(project.version).toBe(4);
  });

  it('takes the chosen title option', async () => {
    const t = build();
    const project = seedProject(t.db, { aiSuggestion: suggestion(PROJECT_OUTPUT) });
    expect((await t.service.apply(ORG, USER, project.id, { project: ['title'], titleOption: 2 }, '3')).title).toBe(PROJECT_OUTPUT.titleOptions[2]);
    const second = seedProject(t.db, { slug: 'other-slug', aiSuggestion: suggestion(PROJECT_OUTPUT) });
    expect((await t.service.apply(ORG, USER, second.id, { project: ['title'] }, '3')).title).toBe(PROJECT_OUTPUT.titleOptions[0]);
  });

  it('answers 412 for a stale If-Match and 412 without one', async () => {
    const t = build();
    const project = seedProject(t.db, { aiSuggestion: suggestion(PROJECT_OUTPUT) });
    await expect(t.service.apply(ORG, USER, project.id, { project: ['body'] }, '2')).rejects.toBeInstanceOf(PreconditionFailedException);
    await expect(t.service.apply(ORG, USER, project.id, { project: ['body'] }, undefined)).rejects.toBeInstanceOf(PreconditionFailedException);
    expect(project.body).toBe('Old body');
  });

  it('answers 409 with no stored suggestion, for the project and for a photo', async () => {
    const t = build();
    const project = seedProject(t.db);
    const photo = seedPhoto(t.db, project.id);
    await expect(t.service.apply(ORG, USER, project.id, { project: ['body'] }, '3')).rejects.toBeInstanceOf(ConflictException);
    await expect(t.service.apply(ORG, USER, project.id, { photos: [{ photoId: photo.id, fields: ['altText'] }] }, '3')).rejects.toBeInstanceOf(ConflictException);
    expect(project.version).toBe(3);
  });

  it('answers 409 when the stored suggestion lacks the asked-for value', async () => {
    const t = build();
    const project = seedProject(t.db, { aiSuggestion: suggestion({ seoTitle: 'Only this one' }) });
    await expect(t.service.apply(ORG, USER, project.id, { project: ['body'] }, '3')).rejects.toBeInstanceOf(ConflictException);
  });

  it('rolls everything back when one requested field cannot be applied', async () => {
    const t = build();
    const project = seedProject(t.db, { aiSuggestion: suggestion({ seoTitle: 'Only this one' }) });
    await expect(t.service.apply(ORG, USER, project.id, { project: ['seoTitle', 'body'] }, '3')).rejects.toBeInstanceOf(ConflictException);
    expect(project.seoTitle).toBe('Old seo title');
  });

  it('keeps the old slug as a previous slug on a published project', async () => {
    const t = build();
    const project = seedProject(t.db, { status: 'published', aiSuggestion: suggestion(PROJECT_OUTPUT) });
    const result = await t.service.apply(ORG, USER, project.id, { project: ['slug'] }, '3');
    expect(result.slug).toBe('hallway-drywall-patch-conroe');
    expect(result.previousSlugs).toEqual(['old-slug-conroe']);
  });

  it('does not keep the old slug of a draft, and refuses a slug another project uses', async () => {
    const t = build();
    const project = seedProject(t.db, { aiSuggestion: suggestion(PROJECT_OUTPUT) });
    expect((await t.service.apply(ORG, USER, project.id, { project: ['slug'] }, '3')).previousSlugs).toEqual([]);
    const other = seedProject(t.db, { slug: 'taken', aiSuggestion: suggestion({ ...PROJECT_OUTPUT, slug: 'hallway-drywall-patch-conroe' }) });
    await expect(t.service.apply(ORG, USER, other.id, { project: ['slug'] }, '3')).rejects.toBeInstanceOf(ConflictException);
  });

  it('applies the asked-for photo fields only, normalising the file slug', async () => {
    const t = build();
    const project = seedProject(t.db);
    const photo = seedPhoto(t.db, project.id, { aiSuggestion: suggestion({ altText: 'Patched wall beside a door', caption: 'New caption', fileSlug: 'Patch Conroe After!', suggestedRole: 'detail', privacyFlags: [] }) });
    const result = await t.service.apply(ORG, USER, project.id, { photos: [{ photoId: photo.id, fields: ['altText', 'fileSlug'] }] }, '3');
    expect(photo).toMatchObject({ altText: 'Patched wall beside a door', fileSlug: 'patch-conroe-after', caption: 'Old caption', role: 'after' });
    expect(result.photos[0]).toMatchObject({ altText: 'Patched wall beside a door' });
    expect(result.version).toBe(4);
  });

  it('never leaves a retouched before photo: applying the role before resets the variant', async () => {
    const t = build();
    const project = seedProject(t.db);
    const photo = seedPhoto(t.db, project.id, {
      retouchedObjectId: randomUUID(),
      chosenVariant: 'retouched',
      aiRetouched: true,
      aiSuggestion: suggestion({ suggestedRole: 'before' }),
    });
    await t.service.apply(ORG, USER, project.id, { photos: [{ photoId: photo.id, fields: ['role'] }] }, '3');
    expect(photo.role).toBe('before');
    expect(photo.chosenVariant).toBe('enhanced');
  });

  it('is a 404 for a photo of another project', async () => {
    const t = build();
    const project = seedProject(t.db, { aiSuggestion: suggestion(PROJECT_OUTPUT) });
    await expect(t.service.apply(ORG, USER, project.id, { photos: [{ photoId: randomUUID(), fields: ['altText'] }] }, '3')).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('DELETE photos/:photoId/retouch', () => {
  it('removes the variant and its objects and resets a chosen retouched variant to enhanced', async () => {
    const t = build();
    const project = seedProject(t.db);
    const retouched = randomUUID();
    const crop = randomUUID();
    const kept = randomUUID();
    const photo = seedPhoto(t.db, project.id, {
      retouchedObjectId: retouched,
      aiRetouched: true,
      chosenVariant: 'retouched',
      renditions: { card4x3: { objectId: kept, w: 1, h: 1 }, retouchedCard4x3: { objectId: crop, w: 1, h: 1 } },
    });
    const view = await t.service.removeRetouch(ORG, USER, project.id, photo.id);
    expect(view).toMatchObject({ retouchedObjectId: null, aiRetouched: false, chosenVariant: 'enhanced' });
    expect(Object.keys(photo.renditions)).toEqual(['card4x3']);
    expect(t.storage.deleteAll).toHaveBeenCalledWith([retouched, crop], USER, ORG);
  });

  it('keeps another chosen variant', async () => {
    const t = build();
    const project = seedProject(t.db);
    const photo = seedPhoto(t.db, project.id, { retouchedObjectId: randomUUID(), chosenVariant: 'original' });
    expect((await t.service.removeRetouch(ORG, USER, project.id, photo.id)).chosenVariant).toBe('original');
  });
});
