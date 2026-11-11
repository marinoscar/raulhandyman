import type { Prisma } from '@prisma/client';

import { CATALOG } from './catalog';
import { lintProject, type LintPhotoInput, type LintProjectInput, type LintResult, type LintSiblingInput } from './seo-lint';

type ProjectRow = Prisma.ProjectGetPayload<object>;
type PhotoRow = Prisma.ProjectPhotoGetPayload<object>;

export const SIBLING_SELECT = { id: true, slug: true, previousSlugs: true, title: true, metaDescription: true, status: true } as const;

/** A project as the API returns it. */
export function toProjectView(row: ProjectRow) {
  return {
    id: row.id,
    slug: row.slug,
    previousSlugs: row.previousSlugs,
    status: row.status,
    title: row.title,
    serviceSlug: row.serviceSlug,
    townSlug: row.townSlug,
    workNotes: row.workNotes,
    summary: row.summary,
    body: row.body,
    seoTitle: row.seoTitle,
    metaDescription: row.metaDescription,
    completedOn: row.completedOn ? row.completedOn.toISOString().slice(0, 10) : null,
    featured: row.featured,
    coverPhotoId: row.coverPhotoId,
    publishedAt: row.publishedAt,
    version: row.version,
    createdById: row.createdById,
    updatedById: row.updatedById,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/** A photo as the API returns it (no processing internals beyond the status and error). */
export function toPhotoView(row: PhotoRow) {
  return {
    id: row.id,
    projectId: row.projectId,
    sortOrder: row.sortOrder,
    role: row.role,
    originalObjectId: row.originalObjectId,
    enhancedObjectId: row.enhancedObjectId,
    retouchedObjectId: row.retouchedObjectId,
    chosenVariant: row.chosenVariant,
    renditions: row.renditions,
    focalX: row.focalX,
    focalY: row.focalY,
    width: row.width,
    height: row.height,
    dominantColor: row.dominantColor,
    altText: row.altText,
    caption: row.caption,
    fileSlug: row.fileSlug,
    qualityFlags: row.qualityFlags,
    privacyFlags: row.privacyFlags,
    processingStatus: row.processingStatus,
    processingError: row.processingError,
    aiRetouched: row.aiRetouched,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/** Runs the shared SEO lint on a stored project (the same function the web editor runs). */
export function lintStored(project: ProjectRow, photos: readonly PhotoRow[], siblings: readonly LintSiblingInput[]): LintResult {
  const input: LintProjectInput = {
    id: project.id,
    title: project.title,
    seoTitle: project.seoTitle,
    metaDescription: project.metaDescription,
    slug: project.slug,
    body: project.body,
    coverPhotoId: project.coverPhotoId,
    serviceSlug: project.serviceSlug,
    townSlug: project.townSlug,
    completedOn: project.completedOn,
  };
  return lintProject(input, photos as readonly LintPhotoInput[], siblings, CATALOG);
}

/** The object ids a photo holds in storage (originals, derivatives and every rendition). */
export function photoObjectIds(photo: PhotoRow): string[] {
  const ids = [photo.originalObjectId, photo.enhancedObjectId, photo.retouchedObjectId, ...renditionObjectIds(photo.renditions)];
  return ids.filter((id): id is string => typeof id === 'string' && id.length > 0);
}

/** Object ids inside a `renditions` JSON (`{ card4x3: { objectId, width, height }, ... }`). */
export function renditionObjectIds(renditions: unknown): string[] {
  if (!renditions || typeof renditions !== 'object') return [];
  return Object.values(renditions as Record<string, unknown>)
    .map((entry) => (typeof entry === 'string' ? entry : (entry as { objectId?: unknown } | null)?.objectId))
    .filter((id): id is string => typeof id === 'string');
}
