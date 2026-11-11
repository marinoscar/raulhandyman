// The projects export source and its ZIP writer (issue #43), over a fake bypass
// client and a fake media reader: projects.json holds every status and the work
// notes but never the AI suggestion; each photo's original and chosen master are
// in the archive under photos/<slug>/.
import { collectExportOutput, readZipEntries } from '@marinoscar/platform-api/exports/testing';

import { PROJECTS_EXPORT_SOURCE, PROJECTS_ZIP_WRITER, photoStem, sniffExtension } from '../../src/platform/exports/projects.export-source';
import { setExportMediaReader } from '../../src/projects/projects-export.bridge';

const ORG = '11111111-1111-4111-8111-111111111111';
const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 9]);

const projects = [
  { id: 'p1', orgId: ORG, slug: 'deck-repair-conroe', previousSlugs: ['old-deck'], status: 'published', title: 'Deck repair', seoTitle: '', metaDescription: 'm', summary: 's', body: 'b', workNotes: 'PRIVATE note: gate code 0000', serviceSlug: 'fence-and-deck-repair', townSlug: 'conroe', completedOn: new Date('2026-10-02'), featured: false, coverPhotoId: 'ph1', publishedAt: new Date('2026-10-05T14:00:00Z'), createdAt: new Date('2026-10-01'), updatedAt: new Date('2026-10-06'), aiSuggestion: { secret: 'AI-SECRET' }, createdById: 'user-1' },
  { id: 'p2', orgId: ORG, slug: 'draft-fence', previousSlugs: [], status: 'draft', title: 'Draft fence', seoTitle: '', metaDescription: '', summary: '', body: '', workNotes: '', serviceSlug: 'fence-and-deck-repair', townSlug: 'conroe', completedOn: null, featured: false, coverPhotoId: null, publishedAt: null, createdAt: new Date('2026-10-07'), updatedAt: new Date('2026-10-07'), aiSuggestion: { secret: 'AI-SECRET' }, createdById: 'user-1' },
  { id: 'p3', orgId: 'other-org', slug: 'other', previousSlugs: [], status: 'published', title: 'Other org', seoTitle: '', metaDescription: '', summary: '', body: '', workNotes: 'OTHER', serviceSlug: 's', townSlug: 't', completedOn: null, featured: false, coverPhotoId: null, publishedAt: null, createdAt: new Date(), updatedAt: new Date(), aiSuggestion: null, createdById: null },
];
const photo = (id: string, projectId: string, over: Record<string, unknown> = {}) => ({
  id, orgId: ORG, projectId, sortOrder: 0, role: 'after', altText: 'alt', caption: '', fileSlug: 'deck-after', focalX: 0.5, focalY: 0.5, width: 100, height: 80, dominantColor: '#aabbcc',
  chosenVariant: 'enhanced', aiRetouched: false, privacyFlags: ['person'], qualityFlags: [], originalObjectId: `${id}-orig`, enhancedObjectId: `${id}-enh`, retouchedObjectId: null, createdAt: new Date('2026-10-02'),
  project: { slug: projectId === 'p1' ? 'deck-repair-conroe' : 'draft-fence' }, aiSuggestion: { secret: 'AI-SECRET' }, ...over,
});
const photos = [photo('ph1', 'p1'), photo('ph2', 'p1', { chosenVariant: 'original', fileSlug: 'deck-before', role: 'before' }), photo('ph3', 'p2', { fileSlug: 'fence' })];

function fakeDb() {
  const delegate = (rows: Array<Record<string, any>>) => ({
    findMany: jest.fn(async ({ where, select, take }: any) => {
      const clauses = where.AND ?? [where];
      const org = clauses.find((c: any) => c.orgId)?.orgId;
      const after = clauses.find((c: any) => c.id?.gt)?.id.gt as string | undefined;
      return rows
        .filter((row) => row.orgId === org && (after === undefined || row.id > after))
        .sort((a, b) => (a.id < b.id ? -1 : 1))
        .slice(0, take)
        // Honour `select` like Prisma: a column that is not selected is absent.
        .map((row) => Object.fromEntries(Object.entries(row).filter(([key]) => select[key])));
    }),
  });
  return { project: delegate(projects), projectPhoto: delegate(photos) };
}

const ctx = (db: unknown, pageSize = 2) => ({ exportId: 'e', scope: 'org' as const, subjectId: ORG, requestedById: 'u', db: db as never, datamodel: { models: [], enums: [] } as never, pageSize, now: new Date(), timeZone: 'UTC' });

async function drain(db = fakeDb(), pageSize = 2) {
  const out: Record<string, { columns: string[]; rows: any[] }> = {};
  for await (const table of PROJECTS_EXPORT_SOURCE.collect(ctx(db, pageSize), {})) {
    const rows: any[] = [];
    for await (const row of table.rows) rows.push(row);
    out[table.dataset] = { columns: table.columns.map((column) => column.key), rows };
  }
  return out;
}

describe('the projects export source', () => {
  it('is an org source behind projects:read that offers the ZIP writer and JSON', () => {
    expect(PROJECTS_EXPORT_SOURCE).toMatchObject({ id: 'projects', scope: 'org', permission: 'projects:read', formats: ['projects-zip', 'json'] });
    expect(PROJECTS_ZIP_WRITER).toMatchObject({ id: 'projects-zip', extension: 'zip', mimeType: 'application/zip' });
    expect(PROJECTS_EXPORT_SOURCE.fileName!({} as never, {}, 'zip')).toMatch(/^[a-z0-9][a-z0-9-]{0,127}\.[a-z0-9]{1,8}$/);
  });

  it('exports every project of the organization in every status, with the work notes, paged by id', async () => {
    const db = fakeDb();
    const data = await drain(db, 1);
    expect(data.projects!.rows.map((row) => [row.slug, row.status])).toEqual([['deck-repair-conroe', 'published'], ['draft-fence', 'draft']]);
    expect(data.projects!.rows[0].work_notes).toBe('PRIVATE note: gate code 0000');
    expect(data.projects!.rows[0].previous_slugs).toBe('old-deck');
    expect(db.project.findMany.mock.calls.length).toBeGreaterThan(1);
    for (const call of db.project.findMany.mock.calls) expect(JSON.stringify(call[0].where)).toContain(ORG);
  });

  it('never selects or emits the AI suggestion or a user id', async () => {
    const db = fakeDb();
    const data = await drain(db);
    const text = JSON.stringify(data);
    expect(text).not.toContain('AI-SECRET');
    expect(text).not.toMatch(/aiSuggestion|ai_suggestion|createdById|user-1/);
    expect(data.projects!.columns).not.toContain('ai_suggestion');
    for (const call of [...db.project.findMany.mock.calls, ...db.projectPhoto.findMany.mock.calls]) expect(call[0].select.aiSuggestion).toBeUndefined();
  });

  it('lists the photos with the object ids and archive paths of their original and chosen master', async () => {
    const data = await drain();
    expect(data.photos!.rows).toHaveLength(3);
    const first = data.photos!.rows[0];
    expect(first).toMatchObject({ original_object_id: 'ph1-orig', master_object_id: 'ph1-enh', file_stem: 'photos/deck-repair-conroe/deck-after-ph1' });
    expect(data.photos!.rows[1]).toMatchObject({ chosen_variant: 'original', master_object_id: 'ph2-orig' });
  });
});

describe('the projects ZIP writer', () => {
  afterEach(() => setExportMediaReader(null));

  async function build() {
    const reads: Array<[string, string]> = [];
    setExportMediaReader(async (objectId, orgId) => {
      reads.push([objectId, orgId]);
      return objectId.endsWith('-orig') ? png : jpeg;
    });
    const tables = PROJECTS_EXPORT_SOURCE.collect(ctx(fakeDb()), {});
    const { bytes, result } = await collectExportOutput(PROJECTS_ZIP_WRITER, tables, 'projects');
    return { entries: readZipEntries(bytes), result, reads };
  }

  it('holds projects.json and, per photo, the original and the chosen master (the original only once)', async () => {
    const { entries, result, reads } = await build();
    expect(result.rowCounts).toEqual({ projects: 2, photos: 3 });
    expect(entries.map((entry) => entry.name).sort()).toEqual([
      'photos/deck-repair-conroe/deck-after-ph1-master.jpg',
      'photos/deck-repair-conroe/deck-after-ph1-original.png',
      'photos/deck-repair-conroe/deck-before-ph2-original.png',
      'photos/draft-fence/fence-ph3-master.jpg',
      'photos/draft-fence/fence-ph3-original.png',
      'projects.json',
    ]);
    expect(entries.find((entry) => entry.name.endsWith('ph1-master.jpg'))!.data.equals(jpeg)).toBe(true);
    expect(reads.every(([, org]) => org === ORG)).toBe(true);
  });

  it('writes projects.json with every status, the work notes, nested photos and no AI suggestion or storage id', async () => {
    const { entries } = await build();
    const text = entries.find((entry) => entry.name === 'projects.json')!.data.toString('utf8');
    const doc = JSON.parse(text);
    expect(doc).toMatchObject({ schemaVersion: 1, source: 'projects' });
    expect(doc.projects.map((p: any) => p.status)).toEqual(['published', 'draft']);
    expect(doc.projects[0].work_notes).toBe('PRIVATE note: gate code 0000');
    expect(doc.projects[0].photos.map((p: any) => p.id)).toEqual(['ph1', 'ph2']);
    expect(text).not.toMatch(/AI-SECRET|ai_suggestion|-orig|-enh|org_id|user-1/);
  });

  it('fails with a clear error when the media store is not available', async () => {
    setExportMediaReader(null);
    await expect(collectExportOutput(PROJECTS_ZIP_WRITER, PROJECTS_EXPORT_SOURCE.collect(ctx(fakeDb()), {}), 'projects')).rejects.toThrow(/media store is not available/);
  });
});

describe('helpers', () => {
  it('sniffs the image type from the bytes', () => {
    expect(sniffExtension(jpeg)).toBe('jpg');
    expect(sniffExtension(png)).toBe('png');
    expect(sniffExtension(Buffer.from('RIFF....WEBP'))).toBe('webp');
    expect(sniffExtension(Buffer.from('abc'))).toBe('bin');
  });
  it('builds a safe archive stem', () => {
    expect(photoStem({ id: 'abcdef0123', fileSlug: '../Odd Name!', project: { slug: 'a-b' } })).toBe('photos/a-b/Odd-Name-abcdef01');
  });
});
