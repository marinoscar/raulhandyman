// The prompts are versioned constants: any wording change must bump the version
// and update the committed snapshot, so it is reviewed.
import { buildCopySystemPrompt, buildCopyUserText, PROJECTS_COPY_PROMPT_VERSION, SITE_VOICE_SAMPLES } from '../../../src/projects/ai/projects-copy.prompt';
import { buildRetouchPrompt, PROJECTS_RETOUCH_PROMPT_VERSION } from '../../../src/projects/ai/projects-retouch.prompt';
import { copySchemaFor, narrowSchemaFor, projectCopySchema } from '../../../src/projects/ai/projects-copy.schema';
import { AI_SUGGEST_JOB, PHOTO_RETOUCH_JOB } from '../../../src/projects/ai/projects-ai.constants';
import { PROJECTS_COPY_FEATURE } from '../../../src/platform/ai/projects-copy.feature';
import { PROJECTS_RETOUCH_FEATURE } from '../../../src/platform/ai/projects-retouch.feature';

describe('copy prompt', () => {
  it('is version 1', () => {
    expect(PROJECTS_COPY_PROMPT_VERSION).toBe('projects.copy.v1');
  });

  it('matches the committed snapshot', () => {
    expect(buildCopySystemPrompt()).toMatchSnapshot();
  });

  it('carries the grounding, SEO and privacy rules, the town and the two voice samples', () => {
    const prompt = buildCopySystemPrompt('Example City');
    expect(prompt).toContain('Example City, TX');
    expect(prompt).toContain('Use ONLY what is visible in the photos or stated in the notes');
    expect(prompt).toContain('Never invent prices, durations, materials, brands, customer names, addresses or outcomes');
    expect(prompt).toContain('No keyword stuffing');
    expect(prompt).toContain('<Work done> in <Town>, TX');
    expect(prompt).toContain('house numbers');
    for (const sample of SITE_VOICE_SAMPLES) expect(prompt).toContain(sample);
  });

  it('builds the user turn from the notes and names the photos in order', () => {
    const text = buildCopyUserText({
      serviceName: 'Drywall repair',
      townName: 'Example City',
      title: '',
      workNotes: 'Patched a hole.',
      photos: [{ photoId: 'p1', role: 'after', altText: '' }],
      fields: ['project', 'photos'],
    });
    expect(text).toMatchSnapshot();
    expect(buildCopyUserText({ serviceName: 'a', townName: 'b', title: '', workNotes: '', photos: [], fields: ['project'], regenerate: { field: 'seoTitle', avoid: 'Old title' } })).toContain(
      'Give a different option than: Old title',
    );
  });
});

describe('retouch prompt', () => {
  it('is version 1', () => {
    expect(PROJECTS_RETOUCH_PROMPT_VERSION).toBe('projects.retouch.v1');
  });

  it('matches the committed snapshot for the default options', () => {
    expect(buildRetouchPrompt()).toMatchSnapshot();
  });

  it('only switches clauses, and the protective clause is always present', () => {
    const none = buildRetouchPrompt({ declutter: false, evenLighting: false, straighten: false });
    expect(none).toMatchSnapshot();
    for (const prompt of [buildRetouchPrompt(), none, buildRetouchPrompt({ declutter: true, evenLighting: false, straighten: false })]) {
      expect(prompt).toContain('Do NOT change, add, remove, repair, recolor or restyle any part of the building');
      expect(prompt).toContain('Keep it photorealistic. No text, no watermark.');
    }
    expect(buildRetouchPrompt({ declutter: false, evenLighting: true, straighten: true })).not.toContain('Remove only loose clutter');
    expect(buildRetouchPrompt()).toContain('Remove only loose clutter: trash, bins, hoses, cords, tools, ladders, packaging, debris.');
  });
});

describe('wiring pins', () => {
  it('the job types and feature ids are permanent', () => {
    expect(AI_SUGGEST_JOB).toBe('projects.ai.suggest');
    expect(PHOTO_RETOUCH_JOB).toBe('projects.photo.retouch');
    expect(PROJECTS_COPY_FEATURE).toMatchObject({ id: 'projects_copy', needs: ['responses', 'structured_output'], inputModalities: ['image'] });
    expect(PROJECTS_RETOUCH_FEATURE).toMatchObject({ id: 'projects_retouch', needs: ['image_edit'] });
  });
});

describe('copy output schema', () => {
  const words = (n: number) => Array.from({ length: n }, (_, i) => `word${i}`).join(' ');
  const valid = {
    titleOptions: ['Hallway drywall patch', 'Wall hole repaired well', 'Patch near the hall door'],
    slug: 'hallway-drywall-patch',
    seoTitle: 'Drywall Patch in Conroe, TX',
    metaDescription: 'A hallway drywall hole patched and textured to match the wall. Ask for a free estimate today.',
    summary: 'A patched wall.',
    body: words(160),
    photos: [{ photoId: '33333333-3333-4333-8333-333333333333', altText: 'Patched wall', caption: 'Done', fileSlug: 'patch-after', suggestedRole: 'after', privacyFlags: ['person'] }],
    warnings: [],
  };

  it('accepts a valid answer and rejects the limits the issue sets', () => {
    expect(projectCopySchema.safeParse(valid).success).toBe(true);
    expect(projectCopySchema.safeParse({ ...valid, titleOptions: valid.titleOptions.slice(0, 2) }).success).toBe(false);
    expect(projectCopySchema.safeParse({ ...valid, slug: 'Not A Slug' }).success).toBe(false);
    expect(projectCopySchema.safeParse({ ...valid, seoTitle: 'x'.repeat(61) }).success).toBe(false);
    expect(projectCopySchema.safeParse({ ...valid, metaDescription: 'short' }).success).toBe(false);
    expect(projectCopySchema.safeParse({ ...valid, photos: [{ ...valid.photos[0], suggestedRole: 'cover' }] }).success).toBe(false);
    expect(projectCopySchema.safeParse({ ...valid, photos: [{ ...valid.photos[0], altText: 'x'.repeat(126) }] }).success).toBe(false);
  });

  it('asks only for the requested scopes and for one key when narrowed', () => {
    expect(Object.keys(copySchemaFor(['photos']).shape)).toEqual(['photos', 'warnings']);
    expect(Object.keys(copySchemaFor(['project']).shape)).toEqual(expect.not.arrayContaining(['photos']));
    expect(Object.keys(narrowSchemaFor('seoTitle').shape)).toEqual(['seoTitle', 'warnings']);
    expect(Object.keys(narrowSchemaFor('title').shape)).toEqual(['titleOptions', 'warnings']);
    expect(Object.keys(narrowSchemaFor('altText').shape)).toEqual(['photos', 'warnings']);
  });
});
