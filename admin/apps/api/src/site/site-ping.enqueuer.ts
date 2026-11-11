import { Injectable } from '@nestjs/common';
import { JobReason, JobsService } from '@marinoscar/platform-api/jobs';

import { SITE_PING_JOB, SITE_PING_SUBJECT_TYPE } from './site-ping.job';
import { SitePingPort, type SitePingRequest } from './site.ports';

/** Binds `SitePingPort` to the queue: the ping is a job, never work inside the request. One active ping per organization. */
@Injectable()
export class SitePingEnqueuer extends SitePingPort {
  constructor(private readonly jobs: JobsService) {
    super();
  }

  async requestPing(request: SitePingRequest): Promise<void> {
    await this.jobs.enqueue({
      type: SITE_PING_JOB,
      reason: JobReason.rerun,
      subjectType: SITE_PING_SUBJECT_TYPE,
      subjectId: request.orgId,
      orgId: request.orgId,
      payload: { orgId: request.orgId, fromVersion: request.fromVersion, toVersion: request.toVersion },
    });
  }
}
