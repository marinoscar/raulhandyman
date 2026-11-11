// =============================================================================
// The minimal example of an app export source: the user's notes
// =============================================================================
//
// The platform's `user-data` source already exports every user-owned model the
// registry marks `export: 'include'` (the sample `Note` is one), as raw
// columns. A source of your own is for a shaped dataset: chosen columns, a
// request the user fills in (here: include archived notes or not), a file name.
//
// A source reads through `ctx.db` (the BYPASS client) with an EXPLICIT owner
// filter (`ctx.subjectId`), pages its query by id, and never writes. It is
// registered at import time by `./exports.slice.ts`; the export dialog draws
// its fields from `requestSchema`.
// =============================================================================

import type { ExportContext, ExportRow, ExportSource, ExportTable } from '@marinoscar/platform-api/exports';
import { z } from 'zod';

export const notesExportRequestSchema = z
  .object({ includeArchived: z.boolean().default(true).describe('Include archived notes') })
  .strict();

export type NotesExportRequest = z.infer<typeof notesExportRequestSchema>;

interface NoteRow {
  id: string;
  title: string;
  body: string;
  archived: boolean;
  createdAt: Date;
  updatedAt: Date;
}

async function* noteRows(ctx: ExportContext, req: NotesExportRequest): AsyncGenerator<ExportRow> {
  let after: string | undefined;
  for (;;) {
    const where: Record<string, unknown> = { userId: ctx.subjectId, ...(req.includeArchived ? {} : { archived: false }) };
    const page = (await ctx.db.note.findMany({
      where: after === undefined ? where : { AND: [where, { id: { gt: after } }] },
      select: { id: true, title: true, body: true, archived: true, createdAt: true, updatedAt: true },
      orderBy: { id: 'asc' },
      take: ctx.pageSize,
    })) as NoteRow[];
    for (const note of page) {
      yield {
        id: note.id,
        title: note.title,
        body: note.body,
        archived: note.archived,
        created_at: note.createdAt.toISOString(),
        updated_at: note.updatedAt.toISOString(),
      };
    }
    if (page.length < ctx.pageSize) return;
    after = page[page.length - 1]!.id;
  }
}

export const NOTES_EXPORT_SOURCE: ExportSource<NotesExportRequest> = {
  id: 'notes',
  scope: 'user',
  label: 'Notes',
  description: 'Your notes as one table: title, text, archived flag and dates.',
  // The exact permission `GET /api/notes` enforces.
  permission: 'notes:read',
  requestSchema: notesExportRequestSchema,
  formats: ['csv-single', 'json', 'csv', 'xlsx'],
  async *collect(ctx, req): AsyncGenerator<ExportTable> {
    yield {
      dataset: 'notes',
      title: 'Notes',
      columns: [
        { key: 'id', label: 'Id', type: 'string' },
        { key: 'title', label: 'Title', type: 'string' },
        { key: 'body', label: 'Text', type: 'string' },
        { key: 'archived', label: 'Archived', type: 'boolean' },
        { key: 'created_at', label: 'Created at', type: 'datetime' },
        { key: 'updated_at', label: 'Updated at', type: 'datetime' },
      ],
      rows: noteRows(ctx, req),
    };
  },
  // Validated values and the source id only: always matches EXPORT_FILE_NAME_PATTERN.
  fileName: (_ctx, req, ext) => `notes${req.includeArchived ? '' : '-active'}.${ext}`,
};

/** This app's export sources and writers. Append here (`registerExportSource` / `registerExportWriter` run for each). */
export const APP_EXPORT_SOURCES: readonly ExportSource<any>[] = [NOTES_EXPORT_SOURCE];
