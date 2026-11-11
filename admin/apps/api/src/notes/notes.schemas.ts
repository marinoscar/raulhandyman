import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/** `POST /api/notes`. */
export const createNoteSchema = z.object({
  title: z.string().trim().min(1).max(200),
  body: z.string().max(20_000).default(''),
});

/** `PATCH /api/notes/:id`: every field optional, at least one present. */
export const updateNoteSchema = z
  .object({
    title: z.string().trim().min(1).max(200).optional(),
    body: z.string().max(20_000).optional(),
    archived: z.boolean().optional(),
  })
  .refine((patch) => Object.keys(patch).length > 0, { message: 'Nothing to update' });

export class CreateNoteDto extends createZodDto(createNoteSchema) {}
export class UpdateNoteDto extends createZodDto(updateNoteSchema) {}

/** The `notes` system settings namespace (Admin, `system_settings:write`). */
export const notesSettingsSchema = z.object({
  /** Archive a note this many days after its last edit; `0` never archives. */
  archiveAfterDays: z.number().int().min(0).max(3650),
});
export type NotesSettings = z.infer<typeof notesSettingsSchema>;
export const notesSettingsPatchSchema = notesSettingsSchema.partial();
