// =============================================================================
// The projects export: "all projects with their photos" (issue #43)
// =============================================================================
//
// The portfolio is a business asset, so it has an export of its own. The
// platform's `org-data` source deliberately skips `Project` and `ProjectPhoto`
// (`export: 'exclude'` in `src/projects/projects.ownership.ts`: they are
// organization data, not a person's), so this source, scope `org`, shapes them:
//
//   projects.json                      every project of every status, `workNotes`
//                                      included (an internal export), the AI
//                                      suggestion (`aiSuggestion`) never
//   photos/<slug>/<file>-<id8>-original.<ext>   each photo's original
//   photos/<slug>/<file>-<id8>-master.jpg        its chosen master, when it is not the original
//
// The two tables (`projects`, `photos`) are what `collect()` yields, so the
// plain `json` format works too (rows only, no files). The `projects-zip`
// writer builds the archive and streams each photo's bytes from storage one
// file at a time (never the whole archive in memory). The export itself is the
// platform's queue job; signed download and expiry are the platform's.
//
// The writer reads storage through `ProjectMediaStore`, handed over by
// `ProjectsExportBridge` (`src/projects/projects-export.bridge.ts`) at startup.
// =============================================================================

import { once } from 'node:events';
import type { ExportContext, ExportRow, ExportSource, ExportTable, ExportWriter } from '@marinoscar/platform-api/exports';
import { z } from 'zod';

import { getExportMediaReader } from '../../projects/projects-export.bridge';

export const PROJECTS_EXPORT_SOURCE_ID = 'projects';
export const PROJECTS_ZIP_WRITER_ID = 'projects-zip';

export const projectsExportRequestSchema = z.object({}).strict();
export type ProjectsExportRequest = z.infer<typeof projectsExportRequestSchema>;

/** Only these columns are read: `aiSuggestion` and every user id are never selected. */
const PROJECT_SELECT = {
  id: true,
  slug: true,
  previousSlugs: true,
  status: true,
  title: true,
  seoTitle: true,
  metaDescription: true,
  summary: true,
  body: true,
  workNotes: true,
  serviceSlug: true,
  townSlug: true,
  completedOn: true,
  featured: true,
  coverPhotoId: true,
  publishedAt: true,
  createdAt: true,
  updatedAt: true,
} as const;

const PHOTO_SELECT = {
  id: true,
  orgId: true,
  projectId: true,
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
  aiRetouched: true,
  privacyFlags: true,
  qualityFlags: true,
  originalObjectId: true,
  enhancedObjectId: true,
  retouchedObjectId: true,
  createdAt: true,
  project: { select: { slug: true } },
} as const;

const iso = (value: Date | null | undefined): string | null => (value ? value.toISOString() : null);

async function* paged<T extends { id: string }>(ctx: ExportContext, delegate: string, select: object): AsyncGenerator<T> {
  let after: string | undefined;
  for (;;) {
    const where = { orgId: ctx.subjectId };
    const page = (await ctx.db[delegate].findMany({
      where: after === undefined ? where : { AND: [where, { id: { gt: after } }] },
      select,
      orderBy: { id: 'asc' },
      take: ctx.pageSize,
    })) as T[];
    yield* page;
    if (page.length < ctx.pageSize) return;
    after = page[page.length - 1]!.id;
  }
}

type ProjectRecord = { id: string; slug: string; previousSlugs: string[]; status: string; title: string; seoTitle: string; metaDescription: string; summary: string; body: string; workNotes: string; serviceSlug: string; townSlug: string; completedOn: Date | null; featured: boolean; coverPhotoId: string | null; publishedAt: Date | null; createdAt: Date; updatedAt: Date };
type PhotoRecord = { id: string; orgId: string; projectId: string; sortOrder: number; role: string; altText: string; caption: string; fileSlug: string; focalX: number; focalY: number; width: number | null; height: number | null; dominantColor: string | null; chosenVariant: string; aiRetouched: boolean; privacyFlags: string[]; qualityFlags: string[]; originalObjectId: string; enhancedObjectId: string | null; retouchedObjectId: string | null; createdAt: Date; project: { slug: string } };

/** The object id of the photo's chosen variant (the original when the chosen one does not exist). */
export function chosenObjectIdOf(photo: Pick<PhotoRecord, 'chosenVariant' | 'originalObjectId' | 'enhancedObjectId' | 'retouchedObjectId'>): string {
  if (photo.chosenVariant === 'retouched' && photo.retouchedObjectId) return photo.retouchedObjectId;
  if (photo.chosenVariant === 'enhanced' && photo.enhancedObjectId) return photo.enhancedObjectId;
  return photo.originalObjectId;
}

/** The archive path stem of a photo: `photos/<slug>/<fileSlug>-<id8>`. */
export function photoStem(photo: { id: string; fileSlug: string; project: { slug: string } }): string {
  const file = photo.fileSlug.replace(/[^a-z0-9-]/gi, '-').replace(/^-+|-+$/g, '') || 'photo';
  return `photos/${photo.project.slug}/${file}-${photo.id.slice(0, 8)}`;
}

async function* projectRows(ctx: ExportContext): AsyncGenerator<ExportRow> {
  for await (const project of paged<ProjectRecord>(ctx, 'project', PROJECT_SELECT)) {
    yield {
      id: project.id,
      slug: project.slug,
      previous_slugs: project.previousSlugs.join(', '),
      status: project.status,
      title: project.title,
      seo_title: project.seoTitle,
      meta_description: project.metaDescription,
      summary: project.summary,
      body: project.body,
      work_notes: project.workNotes,
      service_slug: project.serviceSlug,
      town_slug: project.townSlug,
      completed_on: iso(project.completedOn)?.slice(0, 10) ?? null,
      featured: project.featured,
      cover_photo_id: project.coverPhotoId,
      published_at: iso(project.publishedAt),
      created_at: iso(project.createdAt),
      updated_at: iso(project.updatedAt),
    };
  }
}

async function* photoRows(ctx: ExportContext): AsyncGenerator<ExportRow> {
  for await (const photo of paged<PhotoRecord>(ctx, 'projectPhoto', PHOTO_SELECT)) {
    const chosen = chosenObjectIdOf(photo);
    yield {
      id: photo.id,
      org_id: photo.orgId,
      project_id: photo.projectId,
      project_slug: photo.project.slug,
      sort_order: photo.sortOrder,
      role: photo.role,
      alt_text: photo.altText,
      caption: photo.caption,
      file_slug: photo.fileSlug,
      focal_x: photo.focalX,
      focal_y: photo.focalY,
      width: photo.width,
      height: photo.height,
      dominant_color: photo.dominantColor,
      chosen_variant: photo.chosenVariant,
      ai_retouched: photo.aiRetouched,
      privacy_flags: photo.privacyFlags.join(', '),
      quality_flags: photo.qualityFlags.join(', '),
      original_object_id: photo.originalObjectId,
      master_object_id: chosen,
      file_stem: photoStem(photo),
      created_at: iso(photo.createdAt),
    };
  }
}

export const PROJECTS_EXPORT_SOURCE: ExportSource<ProjectsExportRequest> = {
  id: PROJECTS_EXPORT_SOURCE_ID,
  scope: 'org',
  label: 'Projects and photos',
  description: 'Every project of the organization (all statuses, with the private work notes) and each photo\'s original and chosen master. An internal copy of the portfolio.',
  // The exact permission `GET /api/projects` enforces.
  permission: 'projects:read',
  requestSchema: projectsExportRequestSchema,
  formats: [PROJECTS_ZIP_WRITER_ID, 'json'],
  async *collect(ctx): AsyncGenerator<ExportTable> {
    yield {
      dataset: 'projects',
      title: 'Projects',
      columns: [
        { key: 'id', label: 'Id', type: 'string' },
        { key: 'slug', label: 'Slug', type: 'string' },
        { key: 'previous_slugs', label: 'Previous slugs', type: 'string' },
        { key: 'status', label: 'Status', type: 'string' },
        { key: 'title', label: 'Title', type: 'string' },
        { key: 'seo_title', label: 'SEO title', type: 'string' },
        { key: 'meta_description', label: 'Meta description', type: 'string' },
        { key: 'summary', label: 'Summary', type: 'string' },
        { key: 'body', label: 'Body (Markdown)', type: 'string' },
        { key: 'work_notes', label: 'Work notes (private)', type: 'string' },
        { key: 'service_slug', label: 'Service', type: 'string' },
        { key: 'town_slug', label: 'Town', type: 'string' },
        { key: 'completed_on', label: 'Completed on', type: 'date' },
        { key: 'featured', label: 'Featured', type: 'boolean' },
        { key: 'cover_photo_id', label: 'Cover photo id', type: 'string' },
        { key: 'published_at', label: 'Published at', type: 'datetime' },
        { key: 'created_at', label: 'Created at', type: 'datetime' },
        { key: 'updated_at', label: 'Updated at', type: 'datetime' },
      ],
      rows: projectRows(ctx),
    };
    yield {
      dataset: 'photos',
      title: 'Photos',
      columns: [
        { key: 'id', label: 'Id', type: 'string' },
        { key: 'org_id', label: 'Organization id', type: 'string' },
        { key: 'project_id', label: 'Project id', type: 'string' },
        { key: 'project_slug', label: 'Project slug', type: 'string' },
        { key: 'sort_order', label: 'Order', type: 'number' },
        { key: 'role', label: 'Role', type: 'string' },
        { key: 'alt_text', label: 'Alt text', type: 'string' },
        { key: 'caption', label: 'Caption', type: 'string' },
        { key: 'file_slug', label: 'File name', type: 'string' },
        { key: 'focal_x', label: 'Focal x', type: 'number' },
        { key: 'focal_y', label: 'Focal y', type: 'number' },
        { key: 'width', label: 'Width', type: 'number' },
        { key: 'height', label: 'Height', type: 'number' },
        { key: 'dominant_color', label: 'Dominant colour', type: 'string' },
        { key: 'chosen_variant', label: 'Chosen variant', type: 'string' },
        { key: 'ai_retouched', label: 'AI retouched', type: 'boolean' },
        { key: 'privacy_flags', label: 'Privacy flags', type: 'string' },
        { key: 'quality_flags', label: 'Quality flags', type: 'string' },
        { key: 'original_object_id', label: 'Original storage object', type: 'string' },
        { key: 'master_object_id', label: 'Chosen master storage object', type: 'string' },
        { key: 'file_stem', label: 'Archive path (without extension)', type: 'string' },
        { key: 'created_at', label: 'Created at', type: 'datetime' },
      ],
      rows: photoRows(ctx),
    };
  },
  // The source id only: always matches EXPORT_FILE_NAME_PATTERN.
  fileName: (_ctx, _req, ext) => `projects.${ext}`,
};

/** The extension of an image from its first bytes (`bin` when unknown). */
export function sniffExtension(bytes: Buffer): string {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8) return 'jpg';
  if (bytes.length >= 8 && bytes.subarray(1, 4).toString('latin1') === 'PNG') return 'png';
  if (bytes.length >= 12 && bytes.subarray(0, 4).toString('latin1') === 'RIFF' && bytes.subarray(8, 12).toString('latin1') === 'WEBP') return 'webp';
  if (bytes.length >= 12 && bytes.subarray(4, 8).toString('latin1') === 'ftyp') return 'heic';
  return 'bin';
}

interface ArchiveLike {
  pipe(out: NodeJS.WritableStream): unknown;
  append(source: string | Buffer, data: { name: string; date?: Date }): unknown;
  finalize(): Promise<void>;
  abort(): void;
  on(event: string, listener: (...args: any[]) => void): unknown;
}

/** The `projects.json` document: each project with its photos. Private AI output and storage ids are not in it. */
export function buildProjectsDocument(projects: readonly ExportRow[], photos: readonly ExportRow[], exportedAt: Date): unknown {
  const byProject = new Map<string, unknown[]>();
  for (const photo of photos) {
    const { org_id: _org, original_object_id: _original, master_object_id: _master, ...rest } = photo as Record<string, unknown>;
    const list = byProject.get(String(photo.project_id)) ?? [];
    list.push(rest);
    byProject.set(String(photo.project_id), list);
  }
  return {
    schemaVersion: 1,
    source: PROJECTS_EXPORT_SOURCE_ID,
    exportedAt: exportedAt.toISOString(),
    projects: projects.map((project) => ({ ...project, photos: byProject.get(String(project.id)) ?? [] })),
  };
}

export const PROJECTS_ZIP_WRITER: ExportWriter = {
  id: PROJECTS_ZIP_WRITER_ID,
  label: 'Projects with photos (ZIP)',
  mimeType: 'application/zip',
  extension: 'zip',
  sources: [PROJECTS_EXPORT_SOURCE_ID],
  async write(tables, out, ctx) {
    const datasets: Record<string, ExportRow[]> = {};
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const archive = (require('archiver') as (format: string, options?: object) => ArchiveLike)('zip', { zlib: { level: 6 } });
    const finished = new Promise<void>((resolve, reject) => {
      out.once('finish', resolve);
      out.on('error', reject);
      out.once('close', () => {
        if (!out.writableFinished) reject(out.errored ?? new Error('The export stream was closed'));
      });
      archive.on('error', reject);
      archive.on('warning', reject);
    });
    finished.catch(() => undefined);
    archive.pipe(out);
    try {
      for await (const table of tables) {
        const rows: ExportRow[] = [];
        for await (const row of table.rows) rows.push(row);
        datasets[table.dataset] = rows;
      }
      const projects = datasets.projects ?? [];
      const photos = datasets.photos ?? [];
      const doc = buildProjectsDocument(projects, photos, ctx.exportedAt);
      archive.append(`${JSON.stringify(doc, null, 2)}\n`, { name: 'projects.json', date: ctx.exportedAt });

      const reader = getExportMediaReader();
      for (const photo of photos) {
        const orgId = String(photo.org_id);
        const stem = String(photo.file_stem);
        const original = String(photo.original_object_id);
        const master = String(photo.master_object_id);
        const files: Array<{ suffix: string; objectId: string }> = [{ suffix: 'original', objectId: original }];
        if (master !== original) files.push({ suffix: 'master', objectId: master });
        for (const file of files) {
          // One file at a time: read, append, wait for the archive to take it (the extension comes from the bytes).
          const bytes = await reader(file.objectId, orgId);
          const entry = once(archive as never, 'entry');
          archive.append(bytes, { name: `${stem}-${file.suffix}.${sniffExtension(bytes)}`, date: ctx.exportedAt });
          await Promise.race([entry, finished]);
        }
      }
      await archive.finalize();
      await finished;
      return { rowCounts: { projects: projects.length, photos: photos.length } };
    } catch (error) {
      archive.abort();
      const err = error instanceof Error ? error : new Error(String(error));
      if (!out.destroyed) {
        out.on('error', () => undefined);
        out.destroy(err);
      }
      throw err;
    }
  },
};
