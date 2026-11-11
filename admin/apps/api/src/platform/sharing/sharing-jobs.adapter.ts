// =============================================================================
// SHARING_JOBS adapter: the app's queue, as the sharing slice uses it
// =============================================================================
//
// The handler registry (for `sharing.grants.prune`) and the shared
// `enqueueHousekeepingJob` helper (with the CALLER's logger, so the line is
// attributed to `GrantsPruneTask`). The handler typing is checked at COMPILE
// time below: a sharing handler must satisfy the app's own `JobHandler`, so
// the dispatcher sees exactly the object it would for an app handler. The job
// type is server-only (no `nodeResultSchema`, no `persistNodeResult`).
// =============================================================================

import { Injectable, type Logger } from '@nestjs/common';
import type { SharingJobHandler, SharingJobsPort } from '@marinoscar/platform-api/sharing';

import { enqueueHousekeepingJob } from '@marinoscar/platform-api/jobs';
import type { JobHandler } from '@marinoscar/platform-api/jobs';
import { JobHandlerRegistry } from '@marinoscar/platform-api/jobs';
import { JobsService } from '@marinoscar/platform-api/jobs';
import { PrismaService } from '../../prisma/prisma.service';

/** Compile-time proof that a sharing handler IS an app job handler. */
type AssertAssignable<_From extends _To, _To> = true;
export type SharingJobHandlerIsJobHandler = AssertAssignable<SharingJobHandler, JobHandler>;

@Injectable()
export class SharingJobsAdapter implements SharingJobsPort {
  constructor(
    private readonly jobs: JobsService,
    private readonly registry: JobHandlerRegistry,
    private readonly prisma: PrismaService,
  ) {}

  registerHandler(handler: SharingJobHandler): void {
    const appHandler: JobHandler = handler;
    this.registry.register(appHandler);
  }

  async enqueueHousekeepingJob(options: { type: string; what: string; logger: { log(message: string): void; warn(message: string): void } }): Promise<void> {
    await enqueueHousekeepingJob({
      jobs: this.jobs,
      prisma: this.prisma,
      logger: options.logger as Logger,
      type: options.type,
      what: options.what,
    });
  }
}
