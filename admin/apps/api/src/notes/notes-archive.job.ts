import { Injectable, Logger, Optional, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { JobHandlerRegistry, JobsService, enqueueHousekeepingJob, type Job, type JobHandler } from '@marinoscar/platform-api/jobs';
import { NotificationsService } from '@marinoscar/platform-api/notifications';
import { SystemSettingsService } from '@marinoscar/platform-api/settings';

import { PrismaService } from '../prisma/prisma.service';

/** The job type. Permanent once jobs of this type exist: never rename it. */
export const NOTES_ARCHIVE_JOB = 'notes.archive';

/**
 * Archives notes nobody edited for `notes.archiveAfterDays` days.
 *
 * A registered job handler (it self-registers in `onModuleInit`), so the
 * work is visible, retried and accounted for on the platform queue. Server
 * only: it writes as it goes, so it carries neither `nodeResultSchema` nor
 * `persistNodeResult`.
 *
 * With the notifications slice enabled it also tells each owner how many of
 * their notes it archived (`notes.archived`), after the write committed. The
 * dispatcher is optional: without the slice the job does exactly the above.
 */
@Injectable()
export class NotesArchiveHandler implements JobHandler, OnModuleInit {
  readonly type = NOTES_ARCHIVE_JOB;
  readonly label = 'Archive old notes';
  readonly profile = { maxRuntimeMs: 5 * 60_000, maxAttempts: 3 };
  private readonly logger = new Logger(NotesArchiveHandler.name);

  constructor(
    private readonly registry: JobHandlerRegistry,
    private readonly settings: SystemSettingsService,
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    @Optional() private readonly notifications?: NotificationsService,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async process(job: Job): Promise<void> {
    const days = (await this.settings.getNamespace('notes')).archiveAfterDays;
    if (days === 0) return;
    const cutoff = new Date(Date.now() - days * 86_400_000);
    const { count, perUser } = await this.archiveUntouchedSince(cutoff);
    this.logger.log(`job ${job.id}: archived ${count} note(s) untouched since ${cutoff.toISOString()}`);
    // After the commit, outside any transaction. `notifyNow` is the awaited form
    // for a job handler: it records delivery failures and never rejects.
    const notesUrl = `${(this.config.get<string>('appUrl') ?? '').replace(/\/+$/, '')}/notes`;
    if (this.notifications) {
      for (const [userId, archived] of perUser) {
        await this.notifications.notifyNow('notes.archived', userId, { count: archived, notesUrl });
      }
    }
  }

  /** Archives the untouched notes in one statement, and counts them per owner. */
  private async archiveUntouchedSince(cutoff: Date): Promise<{ count: number; perUser: Map<string, number> }> {
    const where = { archived: false, updatedAt: { lt: cutoff } };
    const perUser = new Map<string, number>();
    if (this.notifications) {
      const owners = await this.prisma.note.groupBy({ by: ['userId'], where, _count: { _all: true } });
      for (const owner of owners) perUser.set(owner.userId, owner._count._all);
    }
    const { count } = await this.prisma.note.updateMany({ where, data: { archived: true } });
    return { count, perUser };
  }
}

/**
 * The nightly trigger. A `@Cron` only decides whether work is due and
 * ENQUEUES it (CLAUDE.md queue rule 1; the `cronEnqueueOnly` conformance
 * suite checks the body).
 */
@Injectable()
export class NotesArchiveTask {
  private readonly logger = new Logger(NotesArchiveTask.name);

  constructor(
    private readonly jobs: JobsService,
    private readonly prisma: PrismaService,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async handleCron(): Promise<void> {
    await enqueueHousekeepingJob({ jobs: this.jobs, prisma: this.prisma, logger: this.logger, type: NOTES_ARCHIVE_JOB, what: 'notes archive' });
  }
}
