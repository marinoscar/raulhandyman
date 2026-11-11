import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

import { SITE_MEDIA_RENDITIONS } from './site-manifest.schema';

/** `POST /api/site/build-status`. */
export const buildStatusSchema = z.object({
  contentVersion: z.string().min(1).max(200),
  status: z.enum(['live', 'failed']),
  durationMs: z.number().int().min(0).max(86_400_000),
  error: z.string().max(2000).optional(),
});
export class BuildStatusDto extends createZodDto(buildStatusSchema) {}
export type BuildStatus = z.infer<typeof buildStatusSchema>;

export const mediaRenditionSchema = z.enum(SITE_MEDIA_RENDITIONS);
