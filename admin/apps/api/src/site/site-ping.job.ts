import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { JobHandlerRegistry, JobScope, type Job, type JobHandler } from '@marinoscar/platform-api/jobs';

import { IndexNowKeyService, keyLocationOf } from './indexnow-key.service';
import { changedPaths, parseSnapshot, SITE_HOST, snapshotOf, toUrls } from './site-changed-urls';
import { SiteService } from './site.service';

/** The job type. Permanent once jobs of this type exist: never rename it. */
export const SITE_PING_JOB = 'projects.site.ping';
export const SITE_PING_SUBJECT_TYPE = 'organization';

export const sitePingPayloadSchema = z.object({
  orgId: z.string().uuid(),
  fromVersion: z.string().nullable(),
  toVersion: z.string().min(1),
});
export type SitePingPayload = z.infer<typeof sitePingPayloadSchema>;

/** The only endpoint this job may call: https and this host, nothing else. */
export const INDEXNOW_ENDPOINT = 'https://api.indexnow.org/indexnow';
export const INDEXNOW_ALLOWED_HOSTS: readonly string[] = ['api.indexnow.org'];
export const INDEXNOW_TIMEOUT_MS = 10_000;
/** IndexNow accepts at most 10,000 URLs per request. */
export const INDEXNOW_MAX_URLS = 10_000;

/** Throws unless the URL is https on an allowed host. */
export function assertEgressAllowed(url: string): void {
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:' || !INDEXNOW_ALLOWED_HOSTS.includes(parsed.hostname)) {
    throw new Error(`Outbound request to ${parsed.protocol}//${parsed.hostname} is not allowed`);
  }
}

type PingOutcome = { kind: 'ok' } | { kind: 'config'; message: string } | { kind: 'retry'; message: string };

/** HTTP status to outcome: 200/202 success, 403/422 (and any other 4xx but 429) a configuration error, 429 and 5xx retry. */
export function classifyStatus(status: number): PingOutcome {
  if (status === 200 || status === 202) return { kind: 'ok' };
  if (status === 429 || status >= 500) return { kind: 'retry', message: `IndexNow answered HTTP ${status}` };
  if (status === 403) return { kind: 'config', message: 'IndexNow rejected the key (HTTP 403): the key file is not reachable at the key location or the key is invalid' };
  if (status === 422) return { kind: 'config', message: 'IndexNow rejected the URLs (HTTP 422): they do not belong to the host or the key does not match' };
  return { kind: 'config', message: `IndexNow rejected the request (HTTP ${status})` };
}

const chunk = <T>(items: readonly T[], size: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
};

/**
 * `projects.site.ping`: tells IndexNow (Bing, Yandex, Seznam and others) which
 * site URLs changed after a build went live.
 *
 * Enqueued ONLY by `POST /api/site/build-status` with `live` (through
 * `SitePingPort`), never inline in a request. Payload `{ orgId, fromVersion,
 * toVersion }`.
 *
 * Changed URLs: the job rebuilds the current manifest, fingerprints each project
 * and diffs against the fingerprint stored with the LAST SUCCESSFUL ping
 * (`SitePublishState.pingSnapshot`), so it needs no old manifest. If the current
 * content version is no longer `toVersion` the job is superseded (a newer build
 * will ping and its diff will cover this change too).
 *
 * Outcomes: 200/202 success, the snapshot advances. 403/422 (any other 4xx but
 * 429) is a configuration error: recorded in `lastPingStatus = config_error`, no
 * retry (the handler returns normally), the snapshot does NOT advance. 429, 5xx
 * and network errors throw, so the queue retries with backoff (maxAttempts 5).
 * No key configured: recorded as `skipped` with an info log.
 *
 * Server only (no `nodeResultSchema` or `persistNodeResult`): it is a single
 * tiny HTTP call and it reads the credential store, which a worker node never
 * holds. Egress is limited to https `api.indexnow.org`.
 */
@Injectable()
export class SitePingHandler implements JobHandler, OnModuleInit {
  readonly type = SITE_PING_JOB;
  readonly label = 'Ping IndexNow after a site build';
  readonly profile = { maxRuntimeMs: 30_000, maxAttempts: 5 };
  private readonly logger = new Logger(SitePingHandler.name);

  constructor(
    private readonly registry: JobHandlerRegistry,
    private readonly scope: JobScope,
    private readonly site: SiteService,
    private readonly keys: IndexNowKeyService,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async process(job: Job): Promise<void> {
    const payload = sitePingPayloadSchema.parse(job.payload);
    if (job.orgId && job.orgId !== payload.orgId) throw new Error(`Job ${job.id} payload organization does not match the job`);
    const { orgId } = payload;

    const key = await this.keys.get();
    if (!key) {
      this.logger.log(`job ${job.id}: no IndexNow key configured, ping skipped`);
      await this.record(job, { lastPingAt: new Date(), lastPingStatus: 'skipped', lastPingError: 'No IndexNow key is configured', lastPingUrlCount: 0 });
      return;
    }

    const manifest = await this.site.buildManifest(orgId);
    if (manifest.contentVersion !== payload.toVersion) {
      this.logger.log(`job ${job.id}: content moved on (${payload.toVersion} -> ${manifest.contentVersion}), a newer build will ping`);
      return;
    }

    const state = await this.scope.run<{ pingSnapshot: Prisma.JsonValue } | null, Prisma.TransactionClient>(job, (tx) =>
      tx.sitePublishState.findFirst({ where: { orgId }, select: { pingSnapshot: true } }),
    );
    const next = snapshotOf(manifest);
    const urls = toUrls(changedPaths(parseSnapshot(state?.pingSnapshot ?? null), next));
    if (urls.length === 0) {
      this.logger.log(`job ${job.id}: nothing changed, no URLs to submit`);
      await this.record(job, { lastPingAt: new Date(), lastPingStatus: 'ok', lastPingError: null, lastPingUrlCount: 0, pingSnapshot: next as unknown as Prisma.InputJsonValue });
      return;
    }

    for (const batch of chunk(urls, INDEXNOW_MAX_URLS)) {
      const outcome = await this.submit({ host: SITE_HOST, key, keyLocation: keyLocationOf(key), urlList: batch });
      if (outcome.kind === 'config') {
        this.logger.error(`job ${job.id}: IndexNow configuration error: ${outcome.message}`);
        await this.record(job, { lastPingAt: new Date(), lastPingStatus: 'config_error', lastPingError: outcome.message, lastPingUrlCount: urls.length });
        return; // no retry: retrying cannot fix the configuration
      }
      if (outcome.kind === 'retry') {
        await this.record(job, { lastPingAt: new Date(), lastPingStatus: 'retrying', lastPingError: outcome.message, lastPingUrlCount: urls.length });
        throw new Error(outcome.message);
      }
    }
    this.logger.log(`job ${job.id}: submitted ${urls.length} URL(s) to IndexNow`);
    await this.record(job, { lastPingAt: new Date(), lastPingStatus: 'ok', lastPingError: null, lastPingUrlCount: urls.length, pingSnapshot: next as unknown as Prisma.InputJsonValue });
  }

  /** One IndexNow request. A network error or timeout is a retry; the key is never logged. */
  private async submit(body: { host: string; key: string; keyLocation: string; urlList: string[] }): Promise<PingOutcome> {
    assertEgressAllowed(INDEXNOW_ENDPOINT);
    try {
      const response = await globalThis.fetch(INDEXNOW_ENDPOINT, {
        method: 'POST',
        headers: { 'content-type': 'application/json; charset=utf-8' },
        body: JSON.stringify(body),
        redirect: 'error',
        signal: AbortSignal.timeout(INDEXNOW_TIMEOUT_MS),
      });
      return classifyStatus(response.status);
    } catch (error) {
      return { kind: 'retry', message: `IndexNow request failed: ${error instanceof Error ? error.name : 'error'}` };
    }
  }

  private record(job: Job, data: Prisma.SitePublishStateUncheckedUpdateInput): Promise<unknown> {
    const orgId = job.orgId as string;
    return this.scope.run<unknown, Prisma.TransactionClient>(job, (tx) =>
      tx.sitePublishState.upsert({ where: { orgId }, create: { ...(data as Prisma.SitePublishStateUncheckedCreateInput), orgId }, update: data }),
    );
  }
}
