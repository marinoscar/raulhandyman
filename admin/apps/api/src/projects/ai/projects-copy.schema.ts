import { z } from 'zod';

/** The photo roles the site understands (the Prisma `PhotoRole`). */
export const COPY_PHOTO_ROLES = ['before', 'after', 'progress', 'detail'] as const;
export const COPY_PRIVACY_FLAGS = ['house_number', 'license_plate', 'person', 'other_pii'] as const;

export const titleOptionsSchema = z.array(z.string().min(10).max(70)).length(3);
const slugField = z
  .string()
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/)
  .max(70);

/** One photo's suggestion, as the model returns it. */
export const photoCopySchema = z.object({
  photoId: z.uuid(),
  altText: z.string().max(125),
  caption: z.string().max(160),
  fileSlug: z
    .string()
    .regex(/^[a-z0-9-]+$/)
    .max(60),
  suggestedRole: z.enum(COPY_PHOTO_ROLES),
  privacyFlags: z.array(z.enum(COPY_PRIVACY_FLAGS)),
});
export type PhotoCopy = z.infer<typeof photoCopySchema>;

/** The project-level fields of a suggestion. */
export const projectCopyShape = {
  titleOptions: titleOptionsSchema,
  slug: slugField,
  seoTitle: z.string().max(60),
  metaDescription: z.string().min(70).max(155),
  summary: z.string().max(280),
  /** Markdown, 150 to 400 words, no H1, optional H2s. */
  body: z.string(),
} as const;

/** The whole structured output of `projects.ai.suggest` (`schemaName: 'ProjectCopy'`). */
export const projectCopySchema = z.object({
  ...projectCopyShape,
  photos: z.array(photoCopySchema),
  /** For example "notes mention a brand not visible in photos". */
  warnings: z.array(z.string()),
});
export type ProjectCopy = z.infer<typeof projectCopySchema>;

export type SuggestScope = 'project' | 'photos';

/** The output schema of a run for the requested scopes (a photos-only run has no project fields, and the reverse). */
export function copySchemaFor(fields: readonly SuggestScope[]) {
  const project = fields.includes('project');
  const photos = fields.includes('photos');
  return z.object({
    ...(project ? projectCopyShape : {}),
    ...(photos ? { photos: z.array(photoCopySchema) } : {}),
    warnings: z.array(z.string()),
  });
}

/** The project fields a single-field regenerate can target. */
export const REGENERATE_PROJECT_FIELDS = ['title', 'seoTitle', 'metaDescription', 'summary', 'body'] as const;
export const REGENERATE_PHOTO_FIELDS = ['altText', 'caption'] as const;
export type RegenerateProjectField = (typeof REGENERATE_PROJECT_FIELDS)[number];
export type RegenerateFieldName = RegenerateProjectField | (typeof REGENERATE_PHOTO_FIELDS)[number];

/** The narrow output of a regenerate: exactly the one key asked for (`title` returns the three `titleOptions`). */
export function narrowSchemaFor(field: RegenerateFieldName) {
  switch (field) {
    case 'title':
      return z.object({ titleOptions: titleOptionsSchema, warnings: z.array(z.string()) });
    case 'seoTitle':
    case 'metaDescription':
    case 'summary':
    case 'body':
      return z.object({ [field]: projectCopyShape[field], warnings: z.array(z.string()) });
    case 'altText':
    case 'caption':
      return z.object({ photos: z.array(z.object({ photoId: z.uuid(), [field]: photoCopySchema.shape[field] })).length(1), warnings: z.array(z.string()) });
  }
}
