import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

import { serviceSlugSchema, townSlugSchema } from './catalog';

const uuid = z.uuid();
const slugSchema = z
  .string()
  .min(3)
  .max(70)
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'Lowercase letters, digits and single hyphens only');
const isoDate = z.iso.date();

/** `POST /api/projects`. */
export const createProjectSchema = z.object({
  serviceSlug: serviceSlugSchema,
  townSlug: townSlugSchema,
  workNotes: z.string().max(20_000).optional(),
  title: z.string().trim().max(200).optional(),
});

/** `PATCH /api/projects/:id` (with `If-Match: <version>`): every field optional, at least one present. */
export const updateProjectSchema = z
  .object({
    title: z.string().trim().max(200).optional(),
    slug: slugSchema.optional(),
    serviceSlug: serviceSlugSchema.optional(),
    townSlug: townSlugSchema.optional(),
    workNotes: z.string().max(20_000).optional(),
    summary: z.string().max(1_000).optional(),
    body: z.string().max(50_000).optional(),
    seoTitle: z.string().trim().max(200).optional(),
    metaDescription: z.string().trim().max(500).optional(),
    completedOn: isoDate.nullable().optional(),
    featured: z.boolean().optional(),
    coverPhotoId: uuid.nullable().optional(),
    /** Only `draft` and `archived`: a project is published through `POST /:id/publish`. */
    status: z.enum(['draft', 'archived']).optional(),
  })
  .refine((patch) => Object.keys(patch).length > 0, { message: 'Nothing to update' });

/** `GET /api/projects`. */
export const listProjectsQuerySchema = z.object({
  status: z.enum(['draft', 'published', 'archived']).optional(),
  service: serviceSlugSchema.optional(),
  q: z.string().trim().max(200).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

const roleSchema = z.enum(['before', 'after', 'progress', 'detail']);

/** `POST /api/projects/:id/photos`. */
export const addPhotoSchema = z.object({ storageObjectId: uuid, role: roleSchema.optional() });

/** `PATCH /api/projects/:id/photos/:photoId`. */
export const updatePhotoSchema = z
  .object({
    role: roleSchema.optional(),
    altText: z.string().trim().max(300).optional(),
    caption: z.string().trim().max(300).optional(),
    fileSlug: z.string().max(200).optional(),
    focalX: z.number().min(0).max(1).optional(),
    focalY: z.number().min(0).max(1).optional(),
    chosenVariant: z.enum(['original', 'enhanced', 'retouched']).optional(),
  })
  .refine((patch) => Object.keys(patch).length > 0, { message: 'Nothing to update' });

/** `POST /api/projects/:id/photos/reorder`: the FULL set of the project's photo ids, in the new order. */
export const reorderPhotosSchema = z.object({ photoIds: z.array(uuid).min(1).max(200) });

export class CreateProjectDto extends createZodDto(createProjectSchema) {}
export class UpdateProjectDto extends createZodDto(updateProjectSchema) {}
export class ListProjectsQueryDto extends createZodDto(listProjectsQuerySchema) {}
export class AddPhotoDto extends createZodDto(addPhotoSchema) {}
export class UpdatePhotoDto extends createZodDto(updatePhotoSchema) {}
export class ReorderPhotosDto extends createZodDto(reorderPhotosSchema) {}

/** Lowercases to `[a-z0-9-]`, collapses runs, trims hyphens and cuts at `max` characters. */
export function slugify(input: string, max: number): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, max)
    .replace(/-+$/g, '');
}

/** Normalises a photo file slug to `[a-z0-9-]`, at most 60 characters. */
export function normalizeFileSlug(input: string): string {
  return slugify(input, 60);
}

/** The slug of a project from a title, or `<service>-<town>-<yyyy-mm>` when there is none. */
export function baseSlug(title: string | undefined, serviceSlug: string, townSlug: string, now: Date): string {
  const fromTitle = title ? slugify(title, 70) : '';
  if (fromTitle.length >= 3) return fromTitle;
  const month = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
  return slugify(`${serviceSlug}-${townSlug}-${month}`, 70);
}
