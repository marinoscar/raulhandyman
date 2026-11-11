import { lintProject, type LintResult } from '@app/shared/seo-lint';

type Args = Parameters<typeof lintProject>;

/** One project, two photos and a sibling: the same input the web and the API lint tests share. */
export function fixtureArgs(): Args {
  return [
    {
      id: 'p-1',
      title: 'Short',
      seoTitle: 'Wall repair',
      metaDescription: 'Too short.',
      slug: 'Bad Slug',
      body: 'A few words only.',
      coverPhotoId: null,
      serviceSlug: 'drywall-repair',
      townSlug: 'town-alpha',
      completedOn: null,
    },
    [
      { id: 'a', role: 'before', altText: 'IMG_0001.jpg', caption: '', fileSlug: '', processingStatus: 'ready', qualityFlags: ['too_dark'], privacyFlags: [] },
      { id: 'b', role: 'after', altText: '', caption: 'After', fileSlug: '', processingStatus: 'processing', qualityFlags: [], privacyFlags: ['house_number'] },
    ],
    [{ id: 'p-2', slug: 'bad-slug', previousSlugs: [], title: 'Short', metaDescription: 'x', status: 'published' }],
    { services: [{ slug: 'drywall-repair', name: 'Drywall repair', seoName: 'Drywall Repair' }], towns: [{ slug: 'town-alpha', name: 'Town Alpha' }] },
  ];
}

export const fixtureLint = (): LintResult => lintProject(...fixtureArgs());
