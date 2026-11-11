import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/** `POST /api/documents`. */
export const createDocumentSchema = z.object({
  title: z.string().trim().min(1).max(200),
  body: z.string().max(20_000).default(''),
});

/** `PATCH /api/documents/:id`: every field optional, at least one present. */
export const updateDocumentSchema = z
  .object({
    title: z.string().trim().min(1).max(200).optional(),
    body: z.string().max(20_000).optional(),
  })
  .refine((patch) => Object.keys(patch).length > 0, { message: 'Nothing to update' });

/** `GET /api/documents?scope=`: `owned` (mine), `shared` (shared with me), `all` (default). */
export const listDocumentsQuerySchema = z.object({
  scope: z.enum(['owned', 'shared', 'all']).default('all'),
});

export class CreateDocumentDto extends createZodDto(createDocumentSchema) {}
export class UpdateDocumentDto extends createZodDto(updateDocumentSchema) {}
export class ListDocumentsQueryDto extends createZodDto(listDocumentsQuerySchema) {}
