import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

import { REGENERATE_PHOTO_FIELDS, REGENERATE_PROJECT_FIELDS } from './projects-copy.schema';
import { DEFAULT_RETOUCH_OPTIONS } from './projects-retouch.prompt';

const uuid = z.uuid();

/** `POST /api/projects/:id/ai/suggest`. */
export const suggestBodySchema = z.object({
  fields: z.array(z.enum(['project', 'photos'])).min(1).max(2).optional(),
  photoIds: z.array(uuid).min(1).max(50).optional(),
});

export const APPLY_PROJECT_FIELDS = ['title', 'slug', 'seoTitle', 'metaDescription', 'summary', 'body'] as const;
export const APPLY_PHOTO_FIELDS = ['altText', 'caption', 'fileSlug', 'role'] as const;

/** `POST /api/projects/:id/ai/apply` (with `If-Match: <version>`). */
export const applyBodySchema = z
  .object({
    project: z.array(z.enum(APPLY_PROJECT_FIELDS)).min(1).optional(),
    /** Which of the three title options `title` takes; default the first. */
    titleOption: z.union([z.literal(0), z.literal(1), z.literal(2)]).optional(),
    photos: z.array(z.object({ photoId: uuid, fields: z.array(z.enum(APPLY_PHOTO_FIELDS)).min(1) })).min(1).max(200).optional(),
  })
  .refine((body) => body.project !== undefined || body.photos !== undefined, { message: 'Name the project fields or the photos to apply' });

/** `POST /api/projects/:id/ai/regenerate`: one project field, or `altText` / `caption` of one photo (`photoId` required then, and only then). */
export const regenerateBodySchema = z
  .object({ field: z.enum([...REGENERATE_PROJECT_FIELDS, ...REGENERATE_PHOTO_FIELDS]), photoId: uuid.optional() })
  .refine((body) => ((REGENERATE_PHOTO_FIELDS as readonly string[]).includes(body.field) ? body.photoId !== undefined : body.photoId === undefined), {
    message: 'A photo field needs photoId, a project field must not have one',
  });

/** `POST /api/projects/:id/photos/:photoId/retouch`: each option defaults to true; at least one must stay on. */
export const retouchBodySchema = z
  .object({
    options: z
      .object({
        declutter: z.boolean().default(true),
        evenLighting: z.boolean().default(true),
        straighten: z.boolean().default(true),
      })
      .default(DEFAULT_RETOUCH_OPTIONS),
  })
  .default({ options: DEFAULT_RETOUCH_OPTIONS })
  .refine((body) => body.options.declutter || body.options.evenLighting || body.options.straighten, { message: 'Switch at least one option on' });

export class SuggestBodyDto extends createZodDto(suggestBodySchema) {}
export class ApplyBodyDto extends createZodDto(applyBodySchema) {}
export class RegenerateBodyDto extends createZodDto(regenerateBodySchema) {}
export class RetouchBodyDto extends createZodDto(retouchBodySchema) {}
export type ApplyBody = z.infer<typeof applyBodySchema>;
export type RegenerateBody = z.infer<typeof regenerateBodySchema>;
