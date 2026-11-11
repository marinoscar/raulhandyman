import { canonicalJson, chosenObjectId, computeContentVersion, hashContent } from '../../src/projects/site-content-version';
import { FakeOrgDb } from './fake-org-db';

const ORG = '11111111-1111-4111-8111-111111111111';

function seed(db: FakeOrgDb, id: string, extra: Record<string, unknown> = {}) {
  db.projects.push({
    id, orgId: ORG, slug: `slug-${id}`, previousSlugs: [], status: 'published', title: `Title ${id}`, serviceSlug: 'drywall-repair', townSlug: 'conroe',
    summary: '', body: 'body', seoTitle: 's', metaDescription: 'm', completedOn: null, featured: false, coverPhotoId: null, publishedAt: new Date('2026-01-01'),
    workNotes: 'private', version: 1, ...extra,
  });
}
function photo(db: FakeOrgDb, projectId: string, id: string, extra: Record<string, unknown> = {}) {
  db.photos.push({
    id, orgId: ORG, projectId, sortOrder: 0, role: 'after', altText: 'alt', caption: '', fileSlug: 'f', focalX: 0.5, focalY: 0.5, width: 1, height: 1, dominantColor: null,
    chosenVariant: 'enhanced', originalObjectId: `orig-${id}`, enhancedObjectId: `enh-${id}`, retouchedObjectId: null, renditions: null, ...extra,
  });
}
const version = (db: FakeOrgDb) => db.prisma.runInOrg(ORG, (tx) => computeContentVersion(tx as never, ORG));

describe('canonicalJson', () => {
  it('sorts keys at every depth and keeps array order', () => {
    expect(canonicalJson({ b: 1, a: { d: [2, 1], c: null } })).toBe('{"a":{"c":null,"d":[2,1]},"b":1}');
    expect(canonicalJson({ a: 1, b: 2 })).toBe(canonicalJson({ b: 2, a: 1 }));
  });
  it('writes dates as ISO strings and drops undefined', () => {
    expect(canonicalJson({ at: new Date('2026-01-01T00:00:00Z'), x: undefined })).toBe('{"at":"2026-01-01T00:00:00.000Z"}');
  });
});

describe('chosenObjectId', () => {
  const base = { originalObjectId: 'o', enhancedObjectId: 'e', retouchedObjectId: 'r' };
  it.each([
    ['original', 'o'],
    ['enhanced', 'e'],
    ['retouched', 'r'],
  ])('%s', (chosenVariant, expected) => expect(chosenObjectId({ ...base, chosenVariant })).toBe(expected));
  it('falls back to the original when the chosen variant does not exist', () => {
    expect(chosenObjectId({ ...base, chosenVariant: 'retouched', retouchedObjectId: null })).toBe('o');
    expect(chosenObjectId({ ...base, chosenVariant: 'enhanced', enhancedObjectId: null })).toBe('o');
  });
});

describe('computeContentVersion', () => {
  it('is a sha256 hex digest, stable for the same content, whatever the row order', async () => {
    const a = new FakeOrgDb();
    seed(a, 'b');
    seed(a, 'a');
    photo(a, 'a', 'p1');
    const b = new FakeOrgDb();
    seed(b, 'a');
    seed(b, 'b');
    photo(b, 'a', 'p1');
    expect(await version(a)).toMatch(/^[0-9a-f]{64}$/);
    expect(await version(a)).toBe(await version(b));
  });

  it('is the hash of nothing for an organization with no published project', async () => {
    const db = new FakeOrgDb();
    seed(db, 'a', { status: 'draft' });
    expect(await version(db)).toBe(hashContent([]));
  });

  it('ignores drafts, archived projects and private fields', async () => {
    const db = new FakeOrgDb();
    seed(db, 'a');
    const before = await version(db);
    seed(db, 'draft', { status: 'draft' });
    seed(db, 'old', { status: 'archived' });
    db.projects[0]!.workNotes = 'changed private notes';
    db.projects[0]!.version = 9;
    db.projects[0]!.updatedAt = new Date();
    expect(await version(db)).toBe(before);
  });

  it.each([
    ['the title', (db: FakeOrgDb) => (db.projects[0]!.title = 'Another title')],
    ['the body', (db: FakeOrgDb) => (db.projects[0]!.body = 'another body')],
    ['the slug', (db: FakeOrgDb) => (db.projects[0]!.slug = 'another-slug')],
    ['the previous slugs', (db: FakeOrgDb) => (db.projects[0]!.previousSlugs = ['old'])],
    ['a photo alt text', (db: FakeOrgDb) => (db.photos[0]!.altText = 'another alt')],
    ['the photo order', (db: FakeOrgDb) => (db.photos[0]!.sortOrder = 3)],
    ['the chosen rendition object', (db: FakeOrgDb) => (db.photos[0]!.chosenVariant = 'original')],
    ['a regenerated rendition', (db: FakeOrgDb) => (db.photos[0]!.renditions = { thumb: { objectId: 'new-thumb' } })],
    ['another published project', (db: FakeOrgDb) => seed(db, 'z')],
  ])('changes with %s', async (_label, change) => {
    const db = new FakeOrgDb();
    seed(db, 'a');
    photo(db, 'a', 'p1');
    const before = await version(db);
    change(db);
    expect(await version(db)).not.toBe(before);
  });

  it('only sees the organization it is scoped to', async () => {
    const db = new FakeOrgDb();
    seed(db, 'a');
    seed(db, 'foreign', { orgId: 'other-org' });
    const alone = new FakeOrgDb();
    seed(alone, 'a');
    // The fake scopes by the transaction's organization; the query also filters on it.
    expect(await version(db)).toBe(await version(alone));
  });
});
