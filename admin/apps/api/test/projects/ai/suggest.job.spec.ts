// `projects.ai.suggest` over the platform's AI harness: the real AiService and a
// scripted fake provider. No network, no key.
import { Logger } from '@nestjs/common';

import { PROJECTS_COPY_FEATURE_ID } from '../../../src/platform/ai/projects-copy.feature';
import { SuggestJobHandler } from '../../../src/projects/ai/suggest.job';
import { AI_SUGGEST_JOB } from '../../../src/projects/ai/projects-ai.constants';
import { buildCopySystemPrompt } from '../../../src/projects/ai/projects-copy.prompt';
import { AI_OBJECT_1, AI_OBJECT_2, copyAnswer, fakeScope, harness, moduleRefOf, ORG, PHOTO_1, PHOTO_2, photoRow, PROJECT, projectRow, USER } from './ai-test-kit';

beforeAll(() => Logger.overrideLogger(false));

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);

function build(opts: { script?: unknown; photos?: Array<Record<string, any>>; project?: Record<string, any> } = {}) {
  const h = harness({ defaultModel: undefined, fake: { imagesPort: true, responses: (opts.script ?? [{ outputText: JSON.stringify(copyAnswer([PHOTO_1, PHOTO_2])) }]) as never } });
  const project = projectRow(opts.project);
  const photos = opts.photos ?? [photoRow(PHOTO_1, AI_OBJECT_1), photoRow(PHOTO_2, AI_OBJECT_2, { role: 'progress' })];
  const { scope, writes } = fakeScope(project, photos);
  const store = { read: jest.fn(async () => JPEG) };
  const events = { publishSuggestReady: jest.fn() };
  const handler = new SuggestJobHandler({ register: jest.fn() } as never, scope, h.ai, moduleRefOf(h), store as never, events as never);
  return { h, handler, project, photos, writes, store, events };
}
const job = (extra: Record<string, unknown> = {}) =>
  ({ id: 'job-1', type: AI_SUGGEST_JOB, orgId: ORG, payload: { orgId: ORG, projectId: PROJECT, userId: USER, fields: ['project', 'photos'], ...extra } }) as never;

describe('projects.ai.suggest job', () => {
  it('is a permanent, server-only type with its declared profile', () => {
    const { handler } = build();
    expect(handler.type).toBe('projects.ai.suggest');
    expect(handler.profile).toEqual({ maxRuntimeMs: 120_000, maxAttempts: 2 });
    expect('nodeResultSchema' in handler).toBe(false);
    expect('persistNodeResult' in handler).toBe(false);
  });

  it('stores a valid suggestion on the project and each photo and never touches the editable fields', async () => {
    const t = build();
    await t.handler.process(job());

    expect(t.writes.project).toHaveLength(1);
    const stored = t.writes.project[0]!.aiSuggestion;
    expect(stored.output.titleOptions).toHaveLength(3);
    expect(stored.output.photos).toBeUndefined();
    expect(stored).toMatchObject({ model: expect.any(String), createdAt: expect.any(String), runId: expect.any(String), promptVersion: 'projects.copy.v1' });
    expect(Array.isArray(stored.lintWarnings)).toBe(true);
    expect(Object.keys(t.writes.project[0]!)).toEqual(['aiSuggestion']);

    expect(t.writes.photos.map((write) => write.id).sort()).toEqual([PHOTO_1, PHOTO_2]);
    for (const write of t.writes.photos) {
      expect(Object.keys(write.data)).toEqual(['aiSuggestion']);
      expect(write.data.aiSuggestion.output.altText).toContain('Patched drywall');
    }
    expect(t.project.title).toBe('');
    expect(t.events.publishSuggestReady).toHaveBeenCalledWith({ orgId: ORG, projectId: PROJECT, userId: USER, jobId: 'job-1' });
  });

  it('sends the images as data URLs, the notes, the grounding prompt and the feature id; nothing else leaks', async () => {
    const t = build();
    await t.handler.process(job());

    const call = t.h.fake.calls.find((entry) => entry.method === 'responses.create')!;
    const request = call.request as any;
    expect(request.instructions).toBe(buildCopySystemPrompt());
    const parts = request.input[0].content as Array<Record<string, any>>;
    const images = parts.filter((part) => part.type === 'image');
    expect(images).toHaveLength(2);
    for (const image of images) expect(image.url).toBe(`data:image/jpeg;base64,${JPEG.toString('base64')}`);
    expect(parts[0]!.text).toContain('Patched a hole near the hallway door');
    expect(parts[0]!.text).toContain('Service:');
    expect(request.structuredOutput.name).toBe('ProjectCopy');
    expect(JSON.stringify(request)).not.toMatch(/sk-|https?:\/\//);
    expect(t.h.usageEvents.every((event) => event.feature === PROJECTS_COPY_FEATURE_ID)).toBe(true);
    expect(t.h.usageEvents.length).toBeGreaterThan(0);
  });

  it('sends at most eight photos, in sortOrder, and only ready ones', async () => {
    const ids = Array.from({ length: 10 }, (_, i) => `33333333-3333-4333-8333-3333333333${String(i + 10)}`);
    const photos = ids.map((id, i) => photoRow(id, `44444444-4444-4444-8444-4444444444${String(i + 10)}`, { sortOrder: i, processingStatus: i === 0 ? 'pending' : 'ready' }));
    const t = build({ photos, script: [{ outputText: JSON.stringify({ ...copyAnswer(ids.slice(1, 9)) }) }] });
    await t.handler.process(job({ fields: ['project'] }));
    const request = t.h.fake.calls.find((entry) => entry.method === 'responses.create')!.request as any;
    const images = (request.input[0].content as Array<Record<string, any>>).filter((part) => part.type === 'image');
    expect(images).toHaveLength(8);
    expect(t.store.read).toHaveBeenCalledTimes(8);
    expect(t.store.read).not.toHaveBeenCalledWith(expect.stringMatching(/10$/), ORG);
  });

  it('marks the job failed with a user-safe error when the model output does not match the schema', async () => {
    const t = build({ script: [{ outputText: JSON.stringify({ titleOptions: ['too short'] }) }] });
    await expect(t.handler.process(job())).rejects.toMatchObject({ name: 'SafeJobError', message: 'The AI answer could not be used. Try again.' });
    expect(t.writes.project).toHaveLength(0);
    expect(t.writes.photos).toHaveLength(0);
    expect(t.events.publishSuggestReady).not.toHaveBeenCalled();
  });

  it('keeps a suggestion whose SEO title fails the lint and marks it with lintWarnings', async () => {
    const answer = { ...copyAnswer([PHOTO_1]), seoTitle: 'x' };
    const t = build({ script: [{ outputText: JSON.stringify(answer) }], photos: [photoRow(PHOTO_1, AI_OBJECT_1)] });
    await t.handler.process(job());
    const lint = t.writes.project[0]!.aiSuggestion.lintWarnings as Array<{ field: string }>;
    expect(lint.some((issue) => issue.field === 'seoTitle')).toBe(true);
    expect(t.writes.project[0]!.aiSuggestion.output.seoTitle).toBe('x');
  });

  it('drops an answer for a photo that was not sent', async () => {
    const stranger = '33333333-3333-4333-8333-33333333ffff';
    const t = build({ script: [{ outputText: JSON.stringify(copyAnswer([PHOTO_1, stranger])) }], photos: [photoRow(PHOTO_1, AI_OBJECT_1)] });
    await t.handler.process(job());
    expect(t.writes.photos.map((write) => write.id)).toEqual([PHOTO_1]);
    expect(t.writes.project[0]!.aiSuggestion.output.warnings.join(' ')).toContain('not sent');
  });

  it('does nothing when the project is gone', async () => {
    const t = build();
    (t.project as any).id = 'x';
    const { scope } = fakeScope(null as never, []);
    const handler = new SuggestJobHandler({ register: jest.fn() } as never, scope, t.h.ai, moduleRefOf(t.h), t.store as never, t.events as never);
    await expect(handler.process(job())).resolves.toBeUndefined();
    expect(t.events.publishSuggestReady).not.toHaveBeenCalled();
  });
});

describe('projects.ai.suggest job: a single-field regenerate', () => {
  const existing = () => ({
    model: 'fake-model',
    createdAt: '2026-01-01T00:00:00.000Z',
    runId: 'run-0',
    promptVersion: 'projects.copy.v1',
    output: { ...copyAnswer([]), photos: undefined, warnings: [] },
  });

  it('replaces exactly one key of the project suggestion and sends the "different option" suffix', async () => {
    const before = existing();
    const t = build({
      project: { aiSuggestion: before, seoTitle: 'Current SEO title in Conroe, TX' },
      script: [{ outputText: JSON.stringify({ seoTitle: 'A New Angle on Drywall in Conroe, TX', warnings: [] }) }],
    });
    await t.handler.process(job({ fields: ['project'], regenerate: { field: 'seoTitle', avoid: 'Current SEO title in Conroe, TX' } }));

    const after = t.writes.project[0]!.aiSuggestion;
    expect(after.output.seoTitle).toBe('A New Angle on Drywall in Conroe, TX');
    const { seoTitle: _a, ...restAfter } = after.output;
    const { seoTitle: _b, ...restBefore } = JSON.parse(JSON.stringify(before.output));
    expect(restAfter).toEqual(restBefore);
    expect(after.runId).toBe('run-0');
    const request = t.h.fake.calls.find((entry) => entry.method === 'responses.create')!.request as any;
    expect(request.input[0].content[0].text).toContain('Give a different option than: Current SEO title in Conroe, TX');
    expect(t.writes.photos).toHaveLength(0);
  });

  it('replaces exactly one key of one photo suggestion', async () => {
    const photoSuggestion = { model: 'fake-model', createdAt: '2026-01-01T00:00:00.000Z', runId: 'run-0', output: { altText: 'Old alt text', caption: 'Old caption', fileSlug: 'old-slug', suggestedRole: 'after', privacyFlags: [] } };
    const t = build({
      photos: [photoRow(PHOTO_1, AI_OBJECT_1, { aiSuggestion: photoSuggestion, altText: 'Current alt' })],
      script: [{ outputText: JSON.stringify({ photos: [{ photoId: PHOTO_1, altText: 'A different description of the patched wall' }], warnings: [] }) }],
    });
    await t.handler.process(job({ fields: ['photos'], photoIds: [PHOTO_1], regenerate: { field: 'altText', photoId: PHOTO_1, avoid: 'Old alt text | Current alt' } }));

    expect(t.writes.photos).toHaveLength(1);
    expect(t.writes.photos[0]!.data.aiSuggestion.output).toEqual({ ...photoSuggestion.output, altText: 'A different description of the patched wall' });
    expect(t.writes.project).toHaveLength(0);
  });

  it('merges the three title options for a title regenerate', async () => {
    const t = build({
      project: { aiSuggestion: existing() },
      script: [{ outputText: JSON.stringify({ titleOptions: ['Another hallway drywall patch', 'Drywall hole fixed in Conroe', 'Patch and texture near the door'], warnings: [] }) }],
    });
    await t.handler.process(job({ fields: ['project'], regenerate: { field: 'title', avoid: 'x' } }));
    expect(t.writes.project[0]!.aiSuggestion.output.titleOptions[0]).toBe('Another hallway drywall patch');
    expect(t.writes.project[0]!.aiSuggestion.output.slug).toBe('drywall-patch-hallway-conroe');
  });
});
