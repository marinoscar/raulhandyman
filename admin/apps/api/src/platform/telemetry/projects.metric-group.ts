// The "Projects & site" group of the Telemetry explorer and dashboard (issue #40).
// Its families read the tables of the metrics declared in
// `src/projects/events/projects.metrics.ts` (table names follow the table rule:
// dots become `_`, a counter gains `_total`, a histogram `_bucket`, a gauge with
// unit `s` gains `_seconds`). A family whose table does not exist yet is
// skipped, so a fresh stack shows "no data yet". The id is permanent once
// dashboards use it. Labels are low cardinality only: no project or org id.
import type { MetricGroupDef } from '@marinoscar/platform-api/telemetry';

declare module '@marinoscar/platform-api/telemetry' {
  interface MetricGroupIds {
    /** Photo processing, AI drafts and retouches, publishing and site builds. */
    projects: true;
  }
}

const FILTERS = ['service', 'instance'] as const;

export const PROJECTS_METRIC_GROUP: MetricGroupDef = {
  id: 'projects',
  label: 'Projects & site',
  title: 'Projects & site',
  order: 80,
  description: 'photo processing time, AI drafts and retouches, publishing, site builds and content staleness',
  families: [
    {
      key: 'projectsPhotoProcessP95',
      group: 'projects',
      label: 'Photo processing p95',
      table: 'app_projects_photo_process_ms_bucket',
      kind: 'histogram',
      unit: 'ms',
      quantile: 0.95,
      groupBy: 'stage',
      requiredColumns: ['le', 'stage'],
      filters: FILTERS,
      series: false,
    },
    {
      key: 'projectsAiSuggestP95',
      group: 'projects',
      label: 'AI draft p95',
      table: 'app_projects_ai_suggest_ms_bucket',
      kind: 'histogram',
      unit: 'ms',
      quantile: 0.95,
      requiredColumns: ['le'],
      filters: FILTERS,
      series: false,
    },
    {
      key: 'projectsAiRetouches',
      group: 'projects',
      label: 'AI retouches',
      table: 'app_projects_ai_retouch_total',
      kind: 'counter',
      unit: 'count',
      rate: 'count',
      groupBy: 'result',
      requiredColumns: ['result'],
      filters: FILTERS,
    },
    {
      key: 'projectsPublished',
      group: 'projects',
      label: 'Publishes',
      table: 'app_projects_published_total',
      kind: 'counter',
      unit: 'count',
      rate: 'count',
      groupBy: 'action',
      requiredColumns: ['action'],
      filters: FILTERS,
    },
    {
      key: 'siteBuildDurationP95',
      group: 'projects',
      label: 'Site build p95',
      table: 'app_site_build_duration_ms_bucket',
      kind: 'histogram',
      unit: 'ms',
      quantile: 0.95,
      groupBy: 'status',
      requiredColumns: ['le', 'status'],
      filters: FILTERS,
      series: false,
    },
    {
      key: 'siteBuildFailures',
      group: 'projects',
      label: 'Site build failures',
      table: 'app_site_build_failures_total',
      kind: 'counter',
      unit: 'count',
      rate: 'count',
      requiredColumns: [],
      filters: FILTERS,
    },
    {
      key: 'siteContentStaleness',
      group: 'projects',
      label: 'Content staleness',
      table: 'app_site_content_staleness_seconds',
      kind: 'gauge',
      unit: 'seconds',
      requiredColumns: [],
      seriesAggregate: 'max',
      bucketAggregate: 'max',
      filters: FILTERS,
      tileAggregate: 'max',
    },
  ],
};
