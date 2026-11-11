// Table-driven tests of the shared SEO lint (`@app/shared`): every rule, the
// length boundaries, and the contract that it is a pure function.
import { lintProject, type LintCatalog, type LintPhotoInput, type LintProjectInput, type LintSiblingInput } from '@app/shared/seo-lint';
import * as sharedRoot from '@app/shared';

import * as apiLint from '../../src/projects/seo-lint';

const words = (n: number) => Array.from({ length: n }, (_, i) => `word${i}`).join(' ');
const chars = (n: number) => 'a'.repeat(n);

const catalog: LintCatalog = {
  services: [{ slug: 'drywall-repair', name: 'Drywall repair', seoName: 'Drywall Repair' }],
  towns: [{ slug: 'conroe', name: 'Conroe' }],
};

const PHOTO: LintPhotoInput = {
  id: 'p1',
  role: 'after',
  altText: 'A patched drywall wall after sanding',
  caption: 'Finished wall',
  fileSlug: 'wall-patch',
  processingStatus: 'ready',
  qualityFlags: [],
  privacyFlags: [],
};
const PROJECT: LintProjectInput = {
  id: 'proj-1',
  title: 'Drywall repair in Conroe, TX',
  seoTitle: 'Drywall Repair in Conroe TX | Quality Patch Work', // 49
  metaDescription: 'See how we repaired a water damaged ceiling and wall in Conroe, with texture matched and paint blended.', // ~100
  slug: 'drywall-repair-conroe',
  body: words(160),
  coverPhotoId: 'p1',
  serviceSlug: 'drywall-repair',
  townSlug: 'conroe',
  completedOn: '2026-05-10',
};

function lint(project: Partial<LintProjectInput> = {}, photos: LintPhotoInput[] = [PHOTO, { ...PHOTO, id: 'p2' }], siblings: LintSiblingInput[] = []) {
  return lintProject({ ...PROJECT, ...project }, photos, siblings, catalog);
}
const codes = (issues: Array<{ code: string }>) => issues.map((issue) => issue.code);
const sibling = (extra: Partial<LintSiblingInput> = {}): LintSiblingInput => ({
  id: 'other',
  slug: 'other-slug',
  previousSlugs: [],
  title: 'Another title entirely',
  metaDescription: 'Another description',
  status: 'published',
  ...extra,
});

describe('a clean project', () => {
  it('has no errors, no warnings and a perfect score', () => {
    expect(lint()).toEqual({ errors: [], warnings: [], score: 100 });
  });
});

describe('length boundaries', () => {
  it.each([
    ['title', 'title', 9, 'title.missing', true],
    ['title', 'title', 10, 'title.missing', false],
    ['title', 'title', 70, 'title.too_long', false],
    ['title', 'title', 71, 'title.too_long', true],
    ['seoTitle', 'seoTitle', 29, 'seo_title.length', true],
    ['seoTitle', 'seoTitle', 30, 'seo_title.length', false],
    ['seoTitle', 'seoTitle', 55, 'seo_title.length', false],
    ['seoTitle', 'seoTitle', 60, 'seo_title.length', false],
    ['seoTitle', 'seoTitle', 61, 'seo_title.length', true],
    ['metaDescription', 'metaDescription', 69, 'meta.length', true],
    ['metaDescription', 'metaDescription', 70, 'meta.length', false],
    ['metaDescription', 'metaDescription', 155, 'meta.length', false],
    ['metaDescription', 'metaDescription', 156, 'meta.length', true],
  ] as const)('%s with %i characters: %s fires = %s', (_label, field, length, code, fires) => {
    expect(codes(lint({ [field]: chars(length) }).errors).includes(code)).toBe(fires);
  });

  it.each([
    [59, true],
    [60, false],
  ])('a body of %i words: body.missing = %s', (n, fires) => {
    expect(codes(lint({ body: words(n) }).errors).includes('body.missing')).toBe(fires);
  });

  it.each([
    [149, true],
    [150, false],
  ])('a body of %i words: body.short warning = %s', (n, fires) => {
    expect(codes(lint({ body: words(n) }).warnings).includes('body.short')).toBe(fires);
  });

  it('does not count markdown punctuation as words', () => {
    expect(codes(lint({ body: `${words(59)} ## --- ***` }).errors)).toContain('body.missing');
  });
});

describe('slug', () => {
  it.each([
    ['ab', true],
    ['abc', false],
    ['Upper-Case', true],
    ['double--hyphen', true],
    ['-leading', true],
    ['trailing-', true],
    ['has_underscore', true],
    ['ok-slug-2', false],
    [chars(70), false],
    [chars(71), true],
  ])('%s: slug.invalid = %s', (slug, fires) => {
    expect(codes(lint({ slug }).errors).includes('slug.invalid')).toBe(fires);
  });

  it('rejects a slug another project uses, or used before', () => {
    expect(codes(lint({}, undefined, [sibling({ slug: PROJECT.slug })]).errors)).toContain('slug.duplicate');
    expect(codes(lint({}, undefined, [sibling({ previousSlugs: ['x', PROJECT.slug] })]).errors)).toContain('slug.duplicate');
    expect(codes(lint({}, undefined, [sibling()]).errors)).not.toContain('slug.duplicate');
  });

  it('ignores the project itself among its siblings', () => {
    expect(codes(lint({}, undefined, [sibling({ id: 'proj-1', slug: PROJECT.slug })]).errors)).not.toContain('slug.duplicate');
  });
});

describe('duplicates among PUBLISHED projects', () => {
  it('flags an equal title and meta description, ignoring case', () => {
    const result = lint({}, undefined, [sibling({ title: PROJECT.title.toUpperCase(), metaDescription: PROJECT.metaDescription.toLowerCase() })]);
    expect(codes(result.errors)).toEqual(expect.arrayContaining(['title.duplicate', 'meta.duplicate']));
  });

  it('does not compare against drafts or archived projects', () => {
    for (const status of ['draft', 'archived']) {
      const result = lint({}, undefined, [sibling({ status, title: PROJECT.title, metaDescription: PROJECT.metaDescription })]);
      expect(codes(result.errors)).not.toContain('title.duplicate');
      expect(codes(result.errors)).not.toContain('meta.duplicate');
    }
  });
});

describe('cover', () => {
  it.each([
    ['no cover', { coverPhotoId: null }, undefined],
    ['a cover that is not a photo of the project', { coverPhotoId: 'ghost' }, undefined],
    ['a cover that is still processing', {}, [{ ...PHOTO, processingStatus: 'processing' }, { ...PHOTO, id: 'p2' }]],
  ] as const)('%s is cover.missing', (_label, project, photos) => {
    expect(codes(lint(project, photos as LintPhotoInput[] | undefined).errors)).toContain('cover.missing');
  });
});

describe('photo rules', () => {
  it.each([
    ['', 'photo.alt_missing'],
    ['too short alt', 'photo.alt_missing'], // 13
    ['IMG_20240101.jpg', 'photo.alt_filename'],
    ['Picture of the wall.PNG', 'photo.alt_filename'],
    ['DSC00123 wall closeup', 'photo.alt_filename'],
    ['img_0042 taken at the house', 'photo.alt_filename'],
    ['wall-patch', 'photo.alt_filename'], // equals fileSlug (and is short)
  ])('alt text %p raises %s', (altText, code) => {
    const result = lint({}, [{ ...PHOTO, altText }, { ...PHOTO, id: 'p2' }]);
    expect(result.errors.filter((issue) => issue.photoId === 'p1').map((issue) => issue.code)).toContain(code);
  });

  it('accepts alt text of exactly 15 characters that is not a file name', () => {
    expect(codes(lint({}, [{ ...PHOTO, altText: 'a'.repeat(15) }, { ...PHOTO, id: 'p2' }]).errors)).not.toContain('photo.alt_missing');
  });

  it.each(['pending', 'processing', 'failed'])('a %s photo is photo.not_ready', (processingStatus) => {
    const result = lint({}, [PHOTO, { ...PHOTO, id: 'p2', processingStatus }]);
    expect(result.errors).toContainEqual(expect.objectContaining({ code: 'photo.not_ready', photoId: 'p2' }));
  });
});

describe('warnings', () => {
  it.each([
    ['town missing from the SEO title', { seoTitle: 'Drywall Repair Specialists | Quality Patch Work' }, 'seo_title.town_missing'],
    ['town missing from the title', { title: 'Drywall repair of a ceiling' }, 'title.town_missing'],
    ['service missing from the SEO title', { seoTitle: 'Ceiling patch in Conroe TX | Quality Patch Work 1' }, 'seo_title.service_missing'],
    ['no completion date', { completedOn: null }, 'completed_on.missing'],
  ] as const)('%s', (_label, project, code) => {
    const result = lint(project);
    expect(result.errors).toEqual([]);
    expect(codes(result.warnings)).toContain(code);
  });

  it('matches the town and service names case-insensitively', () => {
    expect(codes(lint({ seoTitle: 'CONROE drywall REPAIR | Quality Patch Work' }).warnings)).toEqual([]);
  });

  it('warns about fewer than 2 photos', () => {
    expect(codes(lint({}, [PHOTO]).warnings)).toContain('photos.few');
  });

  it('warns about a before photo without an after photo', () => {
    const result = lint({}, [{ ...PHOTO, role: 'before' }, { ...PHOTO, id: 'p2', role: 'detail' }]);
    expect(codes(result.warnings)).toContain('photos.before_without_after');
    expect(codes(lint({}, [{ ...PHOTO, role: 'before' }, { ...PHOTO, id: 'p2' }]).warnings)).not.toContain('photos.before_without_after');
  });

  it('warns about privacy flags, quality flags and an empty caption, per photo', () => {
    const result = lint({}, [{ ...PHOTO, privacyFlags: ['face'], qualityFlags: ['blurry'], caption: '  ' }, { ...PHOTO, id: 'p2' }]);
    expect(result.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'photo.privacy_flags', photoId: 'p1' }),
        expect.objectContaining({ code: 'photo.quality_flags', photoId: 'p1' }),
        expect.objectContaining({ code: 'photo.caption_empty', photoId: 'p1' }),
      ]),
    );
    expect(result.warnings.filter((issue) => issue.photoId === 'p2')).toEqual([]);
  });

  it('skips the name warnings without a catalog', () => {
    const result = lintProject({ ...PROJECT, seoTitle: chars(40) }, [PHOTO, { ...PHOTO, id: 'p2' }], []);
    expect(codes(result.warnings)).toEqual([]);
  });
});

describe('score and shape', () => {
  it('subtracts 12 per error and 4 per warning, never below 0', () => {
    const result = lint({ completedOn: null, title: '' });
    expect(result.score).toBe(100 - 12 * result.errors.length - 4 * result.warnings.length);
    expect(lint({ title: '', seoTitle: '', metaDescription: '', body: '', slug: '', coverPhotoId: null }, [], []).score).toBeGreaterThanOrEqual(0);
  });

  it('gives every issue a code, a field and a message', () => {
    for (const issue of [...lint({ title: '', completedOn: null }).errors, ...lint({ completedOn: null }).warnings]) {
      expect(issue).toEqual(expect.objectContaining({ code: expect.any(String), field: expect.any(String), message: expect.any(String) }));
    }
  });

  it('is pure: the same input gives the same output and the input is not mutated', () => {
    const photos = [PHOTO, { ...PHOTO, id: 'p2', altText: '' }];
    const before = JSON.stringify([PROJECT, photos]);
    expect(lintProject(PROJECT, photos, [], catalog)).toEqual(lintProject(PROJECT, photos, [], catalog));
    expect(JSON.stringify([PROJECT, photos])).toBe(before);
  });

  it('is the same function from the API module, the package root and the subpath (the web uses the same code)', () => {
    expect(apiLint.lintProject).toBe(lintProject);
    expect(sharedRoot.lintProject).toBe(lintProject);
  });
});
