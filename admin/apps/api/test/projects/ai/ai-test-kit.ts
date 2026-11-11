// Shared fixtures for the project AI tests: the platform's AI runtime harness
// (the real `AiService` over a scripted fake provider, no network, no key), an
// in-memory job scope over a few rows, and invented placeholder data.
import { getAiFeature, registerAiFeature } from '@marinoscar/platform-api/ai';
import { createAiRuntimeHarness, HARNESS_IMAGE_MODEL, HARNESS_MODEL, HARNESS_ORG, HARNESS_USER, type AiRuntimeHarnessOptions } from '@marinoscar/platform-api/ai/testing';

import { PROJECTS_COPY_FEATURE } from '../../../src/platform/ai/projects-copy.feature';
import { PROJECTS_RETOUCH_FEATURE } from '../../../src/platform/ai/projects-retouch.feature';

export { HARNESS_IMAGE_MODEL, HARNESS_MODEL, HARNESS_ORG, HARNESS_USER };

export const ORG = HARNESS_ORG;
export const USER = HARNESS_USER;
export const PROJECT = '22222222-2222-4222-8222-222222222222';
export const PHOTO_1 = '33333333-3333-4333-8333-333333333331';
export const PHOTO_2 = '33333333-3333-4333-8333-333333333332';
export const AI_OBJECT_1 = '44444444-4444-4444-8444-444444444441';
export const AI_OBJECT_2 = '44444444-4444-4444-8444-444444444442';
export const ENHANCED = '55555555-5555-4555-8555-555555555555';

for (const feature of [PROJECTS_COPY_FEATURE, PROJECTS_RETOUCH_FEATURE]) {
  if (!getAiFeature(feature.id)) registerAiFeature(feature);
}

export function harness(options: AiRuntimeHarnessOptions = {}) {
  return createAiRuntimeHarness({ fake: { imagesPort: true }, ...options });
}

/** `ModuleRef.get(UsableModelsService)` answered with the harness's real service. */
export const moduleRefOf = (h: ReturnType<typeof harness>) => ({ get: () => h.usableModels }) as never;

type Row = Record<string, any>;

/** A job scope over one project and its photos, recording what the handler wrote. */
export function fakeScope(project: Row, photos: Row[], siblings: Row[] = []) {
  const writes = { project: [] as Row[], photos: [] as Array<{ id: string; data: Row }> };
  const tx = {
    project: {
      findFirst: jest.fn(async () => project),
      findMany: jest.fn(async () => siblings),
      update: jest.fn(async ({ data }: { data: Row }) => {
        writes.project.push(data);
        Object.assign(project, data);
        return project;
      }),
    },
    projectPhoto: {
      findFirst: jest.fn(async ({ where }: { where: Row }) => photos.find((photo) => photo.id === where.id) ?? null),
      findMany: jest.fn(async () => photos),
      update: jest.fn(async ({ where, data }: { where: { id: string }; data: Row }) => {
        writes.photos.push({ id: where.id, data });
        Object.assign(photos.find((photo) => photo.id === where.id)!, data);
        return {};
      }),
    },
  };
  const scope = { run: jest.fn(async (_job: unknown, fn: (tx: unknown) => Promise<unknown>) => fn(tx)) };
  return { scope: scope as never, tx, writes };
}

export function projectRow(extra: Row = {}): Row {
  return {
    id: PROJECT,
    orgId: ORG,
    slug: 'drywall-repair-conroe',
    previousSlugs: [],
    status: 'draft',
    title: '',
    serviceSlug: 'drywall-repair',
    townSlug: 'conroe',
    workNotes: 'Patched a hole near the hallway door. Texture matched. Customer name is Person A, 12 Example Street.',
    summary: '',
    body: '',
    seoTitle: '',
    metaDescription: '',
    completedOn: null,
    coverPhotoId: null,
    aiSuggestion: null,
    version: 1,
    ...extra,
  };
}

export function photoRow(id: string, objectId: string | null, extra: Row = {}): Row {
  return {
    id,
    orgId: ORG,
    projectId: PROJECT,
    sortOrder: id === PHOTO_1 ? 0 : 1,
    role: 'after',
    processingStatus: 'ready',
    renditions: objectId ? { ai1024: { objectId, w: 1024, h: 768 } } : null,
    altText: '',
    caption: '',
    aiSuggestion: null,
    createdById: USER,
    ...extra,
  };
}

const words = (n: number) => Array.from({ length: n }, (_, i) => `word${i}`).join(' ');

/** A valid model answer for the full `ProjectCopy` schema. */
export function copyAnswer(photoIds: string[] = [PHOTO_1]) {
  return {
    titleOptions: ['Drywall patch near a hallway door', 'Hole repair and texture match in Conroe', 'Hallway wall patched and blended'],
    slug: 'drywall-patch-hallway-conroe',
    seoTitle: 'Drywall Patch Repair in Conroe, TX',
    metaDescription: 'A hallway drywall hole patched and textured to match the wall, ready for paint. Ask for a free estimate.',
    summary: 'A hole beside the hallway door was patched and the texture matched.',
    body: words(180),
    photos: photoIds.map((photoId) => ({
      photoId,
      altText: 'Patched drywall beside a hallway door with matched wall texture',
      caption: 'Patch finished and ready for paint',
      fileSlug: 'drywall-patch-conroe-after',
      suggestedRole: 'after',
      privacyFlags: [],
    })),
    warnings: [],
  };
}
