import { Injectable, Logger } from '@nestjs/common';
import { JobReason, JobsService, JobStatus } from '@marinoscar/platform-api/jobs';

import { PrismaService } from '../../prisma/prisma.service';
import { PHOTO_PROCESS_JOB, PHOTO_STAGES, PHOTO_SUBJECT_TYPE, type PhotoStage } from './photo-process.job';

export interface PhotoRef {
  id: string;
  projectId: string;
  orgId: string;
}

const stagesOf = (payload: unknown): PhotoStage[] => {
  const raw = (payload as { stages?: unknown } | null)?.stages;
  return Array.isArray(raw) ? raw.filter((stage): stage is PhotoStage => (PHOTO_STAGES as readonly string[]).includes(stage as string)) : [];
};

/**
 * Enqueues `projects.photo.process` for a photo. The only way the rest of the
 * app starts photo processing; the job itself is the platform queue's.
 *
 * One active job per photo (the queue dedups on type + subject). A request for
 * stages the already-queued job lacks is merged into it while it is still
 * pending; if it is already running, a second job is queued behind it, because
 * the running one will not pick the new stages up.
 */
@Injectable()
export class PhotoProcessingService {
  private readonly logger = new Logger(PhotoProcessingService.name);

  constructor(
    private readonly jobs: JobsService,
    private readonly prisma: PrismaService,
  ) {}

  async enqueue(photo: PhotoRef, stages: readonly PhotoStage[] = PHOTO_STAGES): Promise<void> {
    const wanted = [...new Set(stages)];
    if (wanted.length === 0) return;
    const input = {
      type: PHOTO_PROCESS_JOB,
      reason: wanted.includes('enhance') ? JobReason.upload : JobReason.rerun,
      subjectType: PHOTO_SUBJECT_TYPE,
      subjectId: photo.id,
      orgId: photo.orgId,
      payload: { orgId: photo.orgId, projectId: photo.projectId, photoId: photo.id, stages: wanted },
    };
    const job = await this.jobs.enqueue(input);
    const queued = stagesOf(job.payload);
    const missing = wanted.filter((stage) => !queued.includes(stage));
    if (missing.length === 0) return;

    if (job.status === JobStatus.pending) {
      const merged = [...new Set([...queued, ...wanted])];
      const { count } = await this.prisma.job.updateMany({ where: { id: job.id, status: JobStatus.pending }, data: { payload: { ...input.payload, stages: merged } } });
      if (count > 0) return;
    }
    this.logger.debug(`photo ${photo.id}: a job is already running, queueing a follow-up for ${missing.join(',')}`);
    await this.jobs.enqueue({ ...input, payload: { ...input.payload, stages: missing }, skipDedup: true });
  }
}
