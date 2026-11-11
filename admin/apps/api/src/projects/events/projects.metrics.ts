// =============================================================================
// Projects and site metrics (issue #40)
// =============================================================================
//
// Declared in the otel-core metric-name registry (`registerPlatformHostAppMetrics`
// in `src/platform/registrations.ts`, before bootstrap) and grouped for the
// Telemetry explorer by `PROJECTS_METRIC_GROUP`
// (`src/platform/telemetry/projects.metric-group.ts`). Labels are LOW
// CARDINALITY ONLY: stage, result, action, status. Never a project id or an org
// id (the organization is a span attribute, never a metric label).
//
// Table names follow the table rule (dots become `_`, a counter gains `_total`,
// a histogram `_bucket`, a gauge with a unit `s` gains `_seconds`).
// =============================================================================

import { Injectable, Logger, Optional, type OnModuleInit } from '@nestjs/common';
import { AppMetricsService } from '@marinoscar/platform-api/host';
import { createRegisteredGauge, type AppMetricDef } from '@marinoscar/platform-api/otel-core';

import { PrismaSystemService } from '../../prisma/prisma-system.service';

declare module '@marinoscar/platform-api/otel-core' {
  interface AppMetricKeys {
    projectsPhotoProcessMs: true;
    projectsAiSuggestMs: true;
    projectsAiRetouch: true;
    projectsPublished: true;
    siteBuildDurationMs: true;
    siteBuildFailures: true;
    siteContentStaleness: true;
  }
}

const DURATION_BUCKETS_MS = [50, 100, 250, 500, 1000, 2500, 5000, 10_000, 30_000, 60_000, 120_000, 300_000] as const;
const RESULTS = ['ok', 'failed'] as const;

export const PHOTO_STAGE_VALUES = ['enhance', 'crops', 'og'] as const;
export type PhotoMetricStage = (typeof PHOTO_STAGE_VALUES)[number];
export type MetricResult = (typeof RESULTS)[number];

const oneOf = (...values: readonly string[]) => ({ kind: 'enum' as const, values });

export const PROJECTS_APP_METRICS: readonly AppMetricDef[] = [
  {
    key: 'projectsPhotoProcessMs',
    name: 'app.projects_photo_process_ms',
    kind: 'histogram',
    unit: '{ms}',
    description: 'Time of one photo processing stage (enhance, crops, branded OG).',
    buckets: DURATION_BUCKETS_MS,
    attributes: { stage: oneOf(...PHOTO_STAGE_VALUES), result: oneOf(...RESULTS) },
  },
  {
    key: 'projectsAiSuggestMs',
    name: 'app.projects_ai_suggest_ms',
    kind: 'histogram',
    unit: '{ms}',
    description: 'Time of the AI call of one project copy suggestion.',
    buckets: DURATION_BUCKETS_MS,
    attributes: { result: oneOf(...RESULTS) },
  },
  {
    key: 'projectsAiRetouch',
    name: 'app.projects_ai_retouch',
    kind: 'counter',
    unit: '{retouch}',
    description: 'AI photo retouches finished, by result.',
    attributes: { result: oneOf(...RESULTS) },
  },
  {
    key: 'projectsPublished',
    name: 'app.projects_published',
    kind: 'counter',
    unit: '{project}',
    description: 'Projects published or unpublished.',
    attributes: { action: oneOf('publish', 'unpublish') },
  },
  {
    key: 'siteBuildDurationMs',
    name: 'app.site_build_duration_ms',
    kind: 'histogram',
    unit: '{ms}',
    description: 'Duration of a site build, as the build reported it.',
    buckets: DURATION_BUCKETS_MS,
    attributes: { status: oneOf('live', 'failed') },
  },
  {
    key: 'siteBuildFailures',
    name: 'app.site_build_failures',
    kind: 'counter',
    unit: '{build}',
    description: 'Site builds that reported a failure.',
  },
  {
    key: 'siteContentStaleness',
    name: 'app.site_content_staleness',
    kind: 'gauge',
    unit: 's',
    description: 'Seconds since the last publish while the built site is not the published content (0 when in sync).',
  },
];

/** The staleness of one organization's site: seconds since `lastPublishedAt` while the built version differs. */
export function stalenessSeconds(
  state: { contentVersion: string; lastBuildVersion: string | null; lastPublishedAt: Date | null },
  now: number,
): number {
  if (state.lastBuildVersion === state.contentVersion) return 0;
  if (!state.lastPublishedAt) return 0;
  return Math.max(0, Math.round((now - state.lastPublishedAt.getTime()) / 1000));
}

/**
 * The recording surface of the projects and site metrics. Every method is
 * best-effort and never throws (the platform's metrics host contains faults),
 * and a missing `AppMetricsService` makes them no-ops. Also registers the
 * staleness gauge when gauges are on in this process.
 */
@Injectable()
export class ProjectsMetrics implements OnModuleInit {
  private readonly logger = new Logger(ProjectsMetrics.name);

  constructor(
    @Optional() private readonly metrics?: AppMetricsService,
    @Optional() private readonly system?: PrismaSystemService,
  ) {}

  onModuleInit(): void {
    const context = this.metrics?.gaugeContext?.();
    if (!context || !this.system) return;
    try {
      const gauge = createRegisteredGauge(context.meter, 'siteContentStaleness');
      gauge.addCallback(async (result) => {
        if (!context.gateOpen()) return;
        try {
          const states = await this.system!.runAsSystem('admin-aggregate', (tx) =>
            tx.sitePublishState.findMany({ select: { contentVersion: true, lastBuildVersion: true, lastPublishedAt: true } }),
          );
          const now = context.now();
          result.observe(states.reduce((max, state) => Math.max(max, stalenessSeconds(state, now)), 0));
        } catch (error) {
          this.logger.debug(`staleness gauge skipped: ${error instanceof Error ? error.message : String(error)}`);
        }
      });
    } catch (error) {
      this.logger.debug(`staleness gauge not registered: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  photoStage(stage: PhotoMetricStage, result: MetricResult, durationMs: number): void {
    this.metrics?.record('projectsPhotoProcessMs', durationMs, { stage, result });
  }

  aiSuggest(result: MetricResult, durationMs: number): void {
    this.metrics?.record('projectsAiSuggestMs', durationMs, { result });
  }

  aiRetouch(result: MetricResult): void {
    this.metrics?.add('projectsAiRetouch', 1, { result });
  }

  published(action: 'publish' | 'unpublish'): void {
    this.metrics?.add('projectsPublished', 1, { action });
  }

  siteBuild(status: 'live' | 'failed', durationMs: number): void {
    this.metrics?.record('siteBuildDurationMs', durationMs, { status });
    if (status === 'failed') this.metrics?.add('siteBuildFailures', 1);
  }
}
