import { Injectable } from '@nestjs/common';

/** A build-status report, for the notification and webhook hook. */
export interface SiteBuildEvent {
  orgId: string;
  contentVersion: string;
  durationMs: number;
  error?: string;
}

/**
 * The seam where `site.build.live` and `site.build.failed` will be sent through
 * the notifications and webhooks slices (issue #39). The default does nothing.
 * `SiteService.recordBuild` calls it AFTER the transaction commits and never
 * inside one.
 */
@Injectable()
export class SiteEventsPublisher {
  publishBuildLive(_event: SiteBuildEvent): Promise<void> | void {}
  publishBuildFailed(_event: SiteBuildEvent): Promise<void> | void {}
}

export interface SitePingRequest {
  orgId: string;
  /** The content version the site was last built from before this build (null at the first build). */
  fromVersion: string | null;
  toVersion: string;
}

/**
 * The seam that starts the IndexNow ping. `SiteService.recordBuild` calls it
 * only for a `live` report, after the commit; the real binding (`SitePingEnqueuer`)
 * enqueues the `projects.site.ping` job, so the request never waits on the network.
 */
@Injectable()
export abstract class SitePingPort {
  abstract requestPing(request: SitePingRequest): Promise<void> | void;
}
