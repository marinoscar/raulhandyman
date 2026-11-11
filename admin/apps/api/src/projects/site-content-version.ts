import { createHash } from 'node:crypto';
import type { Prisma } from '@prisma/client';

/** The photo fields that reach the public manifest, plus the object ids of the chosen rendition. */
const PROJECT_SELECT = {
  id: true,
  slug: true,
  previousSlugs: true,
  title: true,
  serviceSlug: true,
  townSlug: true,
  summary: true,
  body: true,
  seoTitle: true,
  metaDescription: true,
  completedOn: true,
  featured: true,
  coverPhotoId: true,
  publishedAt: true,
  photos: {
    select: {
      id: true,
      sortOrder: true,
      role: true,
      altText: true,
      caption: true,
      fileSlug: true,
      focalX: true,
      focalY: true,
      width: true,
      height: true,
      dominantColor: true,
      chosenVariant: true,
      originalObjectId: true,
      enhancedObjectId: true,
      retouchedObjectId: true,
      renditions: true,
    },
  },
} satisfies Prisma.ProjectSelect;

type Snapshot = Prisma.ProjectGetPayload<{ select: typeof PROJECT_SELECT }>;

/** JSON with object keys sorted at every depth, so equal content always serializes equally. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(',')}}`;
}

/** The object id of the photo's chosen variant (the original when the chosen one does not exist yet). */
export function chosenObjectId(photo: {
  chosenVariant: string;
  originalObjectId: string;
  enhancedObjectId: string | null;
  retouchedObjectId: string | null;
}): string {
  if (photo.chosenVariant === 'retouched' && photo.retouchedObjectId) return photo.retouchedObjectId;
  if (photo.chosenVariant === 'enhanced' && photo.enhancedObjectId) return photo.enhancedObjectId;
  return photo.originalObjectId;
}

/** The manifest-relevant content of one published project, canonicalised for hashing. */
function manifestEntry(project: Snapshot): unknown {
  return {
    id: project.id,
    slug: project.slug,
    previousSlugs: [...project.previousSlugs],
    title: project.title,
    serviceSlug: project.serviceSlug,
    townSlug: project.townSlug,
    summary: project.summary,
    body: project.body,
    seoTitle: project.seoTitle,
    metaDescription: project.metaDescription,
    completedOn: project.completedOn ? project.completedOn.toISOString().slice(0, 10) : null,
    featured: project.featured,
    coverPhotoId: project.coverPhotoId,
    publishedAt: project.publishedAt,
    photos: [...project.photos]
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
      .map((photo) => ({
        id: photo.id,
        sortOrder: photo.sortOrder,
        role: photo.role,
        altText: photo.altText,
        caption: photo.caption,
        fileSlug: photo.fileSlug,
        focalX: photo.focalX,
        focalY: photo.focalY,
        width: photo.width,
        height: photo.height,
        dominantColor: photo.dominantColor,
        chosenObjectId: chosenObjectId(photo),
        // The derived renditions (card, hero, og, thumb): their object ids change when a crop is regenerated.
        renditions: photo.renditions ?? null,
      })),
  };
}

/** sha256 (hex) over the canonical JSON of the entries (already sorted by project id). */
export function hashContent(entries: readonly unknown[]): string {
  return createHash('sha256').update(canonicalJson(entries)).digest('hex');
}

/**
 * THE content version of an organization's published site: sha256 over the
 * canonical JSON of every published project's manifest fields and its photos'
 * chosen-rendition object ids, projects sorted by id. Drafts and private
 * fields (`workNotes`, `aiSuggestion`, version counters, timestamps) are not
 * part of it, so editing a draft never changes it. `tx` is any client scoped to
 * the organization (`runInOrg`), so a caller inside a transaction sees its own
 * uncommitted writes. Reused by the site manifest endpoint (#28).
 */
export async function computeContentVersion(tx: Pick<Prisma.TransactionClient, 'project'>, orgId: string): Promise<string> {
  const projects = await tx.project.findMany({ where: { orgId, status: 'published' }, select: PROJECT_SELECT, orderBy: { id: 'asc' } });
  return hashContent([...projects].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)).map(manifestEntry));
}
