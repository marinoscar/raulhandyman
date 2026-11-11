// Projects and site telemetry (issue #40): the metric declarations and their
// label budget, what each call site records, and the span attributes.
import { context, trace } from '@opentelemetry/api';
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks';
import { BasicTracerProvider, InMemorySpanExporter, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { appMetricRegistry } from '@marinoscar/platform-api/otel-core';

// Fills the registries (the platform's metrics, then the projects ones).
import '../../../src/platform/registrations';
import { PROJECTS_METRIC_GROUP } from '../../../src/platform/telemetry/projects.metric-group';
import { ProjectsMetrics, PROJECTS_APP_METRICS, stalenessSeconds } from '../../../src/projects/events/projects.metrics';
import { SitePublishService } from '../../../src/projects/site-publish.service';
import { SiteEventsPublisher } from '../../../src/site/site.ports';
import { SiteService } from '../../../src/site/site.service';

const ORG = '11111111-1111-4111-8111-111111111111';
const PHOTO = '33333333-3333-4333-8333-333333333333';

describe('the projects metric declarations', () => {
  it('are registered under the issue names, with the issue kinds and labels', () => {
    const byName = Object.fromEntries(PROJECTS_APP_METRICS.map((def) => [def.name, def]));
    expect(Object.keys(byName).sort()).toEqual([
      'app.projects_ai_retouch',
      'app.projects_ai_suggest_ms',
      'app.projects_photo_process_ms',
      'app.projects_published',
      'app.site_build_duration_ms',
      'app.site_build_failures',
      'app.site_content_staleness',
    ]);
    expect(byName['app.projects_photo_process_ms']).toMatchObject({ kind: 'histogram' });
    expect(Object.keys(byName['app.projects_photo_process_ms']!.attributes!)).toEqual(['stage', 'result']);
    expect(byName['app.projects_ai_suggest_ms']).toMatchObject({ kind: 'histogram' });
    expect(byName['app.projects_ai_retouch']).toMatchObject({ kind: 'counter' });
    expect(Object.keys(byName['app.projects_published']!.attributes!)).toEqual(['action']);
    expect(Object.keys(byName['app.site_build_duration_ms']!.attributes!)).toEqual(['status']);
    expect(byName['app.site_build_failures']!.attributes).toBeUndefined();
    expect(byName['app.site_content_staleness']).toMatchObject({ kind: 'gauge' });
    for (const def of PROJECTS_APP_METRICS) expect(appMetricRegistry.has(def.key)).toBe(true);
  });

  it('use low-cardinality enum labels only: never an id or an organization', () => {
    for (const def of PROJECTS_APP_METRICS) {
      for (const [name, attribute] of Object.entries(def.attributes ?? {})) {
        expect(name).not.toMatch(/(^|_)(id|org|project|photo|user)(_|$)/);
        expect(attribute.kind).toBe('enum');
      }
    }
  });

  it('are charted by one "Projects & site" group whose families read those tables', () => {
    expect(PROJECTS_METRIC_GROUP).toMatchObject({ id: 'projects', label: 'Projects & site' });
    expect(PROJECTS_METRIC_GROUP.families.map((family) => family.table).sort()).toEqual([
      'app_projects_ai_retouch_total',
      'app_projects_ai_suggest_ms_bucket',
      'app_projects_photo_process_ms_bucket',
      'app_projects_published_total',
      'app_site_build_duration_ms_bucket',
      'app_site_build_failures_total',
      'app_site_content_staleness_seconds',
    ]);
  });
});

describe('stalenessSeconds', () => {
  const published = new Date('2026-11-10T10:00:00Z');
  it('is the time since the last publish while the built version differs, else 0', () => {
    const now = published.getTime() + 600_000;
    expect(stalenessSeconds({ contentVersion: 'b', lastBuildVersion: 'a', lastPublishedAt: published }, now)).toBe(600);
    expect(stalenessSeconds({ contentVersion: 'b', lastBuildVersion: null, lastPublishedAt: published }, now)).toBe(600);
    expect(stalenessSeconds({ contentVersion: 'b', lastBuildVersion: 'b', lastPublishedAt: published }, now)).toBe(0);
    expect(stalenessSeconds({ contentVersion: 'b', lastBuildVersion: 'a', lastPublishedAt: null }, now)).toBe(0);
  });
});

describe('ProjectsMetrics', () => {
  function fake() {
    const calls: Array<[string, string, number, Record<string, unknown> | undefined]> = [];
    const metrics = {
      add: jest.fn((key: string, value: number, attributes?: Record<string, unknown>) => void calls.push(['add', key, value, attributes])),
      record: jest.fn((key: string, value: number, attributes?: Record<string, unknown>) => void calls.push(['record', key, value, attributes])),
      gaugeContext: jest.fn(() => null),
    };
    return { calls, recorder: new ProjectsMetrics(metrics as never, undefined) };
  }

  it('records each metric with only its allowed labels', () => {
    const { calls, recorder } = fake();
    recorder.photoStage('crops', 'ok', 120);
    recorder.aiSuggest('failed', 900);
    recorder.aiRetouch('ok');
    recorder.published('unpublish');
    recorder.siteBuild('live', 4000);
    recorder.siteBuild('failed', 100);
    expect(calls).toEqual([
      ['record', 'projectsPhotoProcessMs', 120, { stage: 'crops', result: 'ok' }],
      ['record', 'projectsAiSuggestMs', 900, { result: 'failed' }],
      ['add', 'projectsAiRetouch', 1, { result: 'ok' }],
      ['add', 'projectsPublished', 1, { action: 'unpublish' }],
      ['record', 'siteBuildDurationMs', 4000, { status: 'live' }],
      ['record', 'siteBuildDurationMs', 100, { status: 'failed' }],
      ['add', 'siteBuildFailures', 1, undefined],
    ]);
  });

  it('is a no-op without the metrics host, and registers no gauge while gauges are off', () => {
    const none = new ProjectsMetrics(undefined, undefined);
    expect(() => none.photoStage('og', 'ok', 1)).not.toThrow();
    expect(() => none.onModuleInit()).not.toThrow();
    expect(() => fake().recorder.onModuleInit()).not.toThrow();
  });
});

describe('call sites record their metrics', () => {
  it('SiteService.recordBuild records the duration by status and a failure counter, from the build-status body', async () => {
    const state: Record<string, unknown>[] = [];
    const tx = {
      sitePublishState: {
        findFirst: jest.fn(async () => state[0] ?? null),
        upsert: jest.fn(async ({ create }: { create: Record<string, unknown> }) => void state.push(create)),
      },
    };
    const prisma = { runInOrg: jest.fn(async (_o: string, fn: (t: unknown) => Promise<unknown>) => fn(tx)) };
    const metrics = { siteBuild: jest.fn() };
    const service = new SiteService(prisma as never, {} as never, {} as never, new SiteEventsPublisher(), { requestPing: jest.fn() } as never, metrics as never);
    await service.recordBuild(ORG, { contentVersion: 'v1', status: 'live', durationMs: 4200 });
    await service.recordBuild(ORG, { contentVersion: 'v2', status: 'failed', durationMs: 90, error: 'x' });
    expect(metrics.siteBuild.mock.calls).toEqual([['live', 4200], ['failed', 90]]);
  });

  it('SitePublishService counts a publish and an unpublish', async () => {
    const metrics = { published: jest.fn() };
    const service = new SitePublishService({ runInOrg: jest.fn() } as never, { publishPublished: jest.fn(), publishUnpublished: jest.fn() } as never, metrics as never);
    const project = { id: 'p', slug: 's', title: 't', status: 'published', version: 1 };
    (service as unknown as { prisma: { runInOrg: jest.Mock } }).prisma.runInOrg.mockResolvedValue({ project, contentVersion: 'v', lint: { errors: [], warnings: [] } });
    await service.publish(ORG, 'u', 'p', 1);
    await service.unpublish(ORG, 'u', 'p', undefined);
    expect(metrics.published.mock.calls).toEqual([['publish'], ['unpublish']]);
  });
});

describe('span attributes', () => {
  const exporter = new InMemorySpanExporter();
  const provider = new BasicTracerProvider({ spanProcessors: [new SimpleSpanProcessor(exporter)] });
  beforeAll(() => {
    context.setGlobalContextManager(new AsyncLocalStorageContextManager().enable());
    trace.setGlobalTracerProvider(provider);
  });
  afterAll(async () => {
    await provider.shutdown();
    trace.disable();
    context.disable();
  });
  beforeEach(() => exporter.reset());

  it('SiteService.getMedia opens a span carrying ids and the rendition only', async () => {
    const photo = { id: PHOTO, width: 1, height: 1, chosenVariant: 'enhanced', originalObjectId: 'o', enhancedObjectId: 'e', retouchedObjectId: null, renditions: {} };
    const prisma = { runInOrg: jest.fn(async () => photo) };
    const media = { file: jest.fn(async () => ({ buffer: Buffer.alloc(1), contentType: 'image/jpeg', width: 1, height: 1, sha256: 'x' })) };
    const service = new SiteService(prisma as never, media as never, {} as never, new SiteEventsPublisher(), { requestPing: jest.fn() } as never);
    await service.getMedia(ORG, PHOTO, 'card4x3');
    const span = exporter.getFinishedSpans().find((candidate) => candidate.name === 'site.media.get');
    expect(span).toBeDefined();
    expect(span!.attributes).toEqual({ 'org.id': ORG, 'photo.id': PHOTO, rendition: 'card4x3' });
  });

  it('SiteService.buildManifest sets org.id on its span', async () => {
    const prisma = { runInOrg: jest.fn(async (_o: string, fn: (t: unknown) => Promise<unknown>) => fn({ project: { findMany: jest.fn(async () => []) } })) };
    const service = new SiteService(prisma as never, {} as never, { get: jest.fn(async () => null) } as never, new SiteEventsPublisher(), { requestPing: jest.fn() } as never);
    await service.buildManifest(ORG);
    const span = exporter.getFinishedSpans().find((candidate) => candidate.name === 'site.manifest.build');
    expect(span!.attributes).toEqual({ 'org.id': ORG });
  });
});
