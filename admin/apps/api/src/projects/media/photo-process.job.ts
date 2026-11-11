import { Injectable, Logger, Optional, type OnModuleInit } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { JobHandlerRegistry, JobScope, type Job, type JobHandler } from '@marinoscar/platform-api/jobs';
import { Trace } from '@marinoscar/platform-api/otel-core';
import { SystemSettingsService } from '@marinoscar/platform-api/settings';

import { setSpanAttributes } from '../events/span-attributes';
import { ProjectsMetrics, type PhotoMetricStage } from '../events/projects.metrics';
import { PhotoEventsPublisher } from '../projects.ports';
import { CROP_SPECS, findFocalPoint, makeCrop, makeCrops, type Focal, type Rendition } from './photo-crops';
import { enhance, type EnhanceResult } from './photo-enhance';
import { renderOgImage } from './photo-og';
import { ProjectMediaStore } from './project-media.store';
import { assessQuality } from './quality';

/** The job type. Permanent once jobs of this type exist: never rename it. */
export const PHOTO_PROCESS_JOB = 'projects.photo.process';
/** `jobs.subject_type` of a photo job. */
export const PHOTO_SUBJECT_TYPE = 'project_photo';

export const PHOTO_STAGES = ['enhance', 'crops', 'og'] as const;
export type PhotoStage = (typeof PHOTO_STAGES)[number];

export const photoProcessPayloadSchema = z.object({
  orgId: z.string().uuid(),
  projectId: z.string().uuid(),
  photoId: z.string().uuid(),
  stages: z.array(z.enum(PHOTO_STAGES)).min(1),
});
export type PhotoProcessPayload = z.infer<typeof photoProcessPayloadSchema>;

const DEFAULT_FOCAL = 0.5;

/** The shown message of a failed photo: never library or storage detail. */
export function safeProcessingError(error: unknown): string {
  const message = error instanceof Error ? error.message : '';
  if (/not found/i.test(message)) return 'The original photo could not be found. Upload it again.';
  if (/storage|bucket|credential/i.test(message)) return 'Storage is not available right now. Processing will be retried.';
  if (/unsupported image format|corrupt|truncated|premature|bad seek|vips|Input (buffer|file)/i.test(message)) {
    return 'The photo could not be read. Upload it again as a JPEG, PNG or WebP.';
  }
  return 'The photo could not be processed. Try again or upload it again.';
}

/** `north-richland-hills` becomes `North Richland Hills`. */
export function townName(slug: string): string {
  return slug
    .split('-')
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

type SpanIds = { orgId: string; projectId: string; photoId: string };
type PhotoRenditions = Record<string, { objectId: string; w: number; h: number }>;

/**
 * `projects.photo.process`: orients, strips metadata and grades a project photo
 * (the enhanced master), then cuts the site's renditions around the focal point
 * and, for the cover photo, renders the branded OG image.
 *
 * Self-registering, server only: it reads and writes several storage objects
 * and rows as it goes, so it carries neither `nodeResultSchema` nor
 * `persistNodeResult`. Every write goes to a deterministic storage key, so a
 * retry after a crash overwrites instead of duplicating.
 *
 * The stages in the payload say what to do: `enhance` (also redoes the crops),
 * `crops` (a focal-point change: the enhanced master is left alone), `og`.
 * The image logic lives in photo-enhance.ts, photo-crops.ts, quality.ts and
 * photo-og.ts as pure Buffer functions; this class only moves bytes and rows.
 */
@Injectable()
export class PhotoProcessHandler implements JobHandler, OnModuleInit {
  readonly type = PHOTO_PROCESS_JOB;
  readonly label = 'Process project photo';
  readonly profile = { maxRuntimeMs: 120_000, maxAttempts: 3 };
  private readonly logger = new Logger(PhotoProcessHandler.name);

  constructor(
    private readonly registry: JobHandlerRegistry,
    private readonly scope: JobScope,
    private readonly settings: SystemSettingsService,
    private readonly store: ProjectMediaStore,
    @Optional() private readonly events?: PhotoEventsPublisher,
    @Optional() private readonly metrics?: ProjectsMetrics,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async process(job: Job): Promise<void> {
    const payload = photoProcessPayloadSchema.parse(job.payload);
    if (job.orgId && job.orgId !== payload.orgId) throw new Error(`Job ${job.id} payload organization does not match the job`);
    const stages = new Set<PhotoStage>(payload.stages);
    const { orgId, projectId, photoId } = payload;

    const photo = await this.scope.run<Prisma.ProjectPhotoGetPayload<{ include: { project: { select: { title: true; townSlug: true; coverPhotoId: true } } } }> | null, Prisma.TransactionClient>(
      job,
      (tx) =>
        tx.projectPhoto.findFirst({
          where: { id: photoId, projectId, orgId },
          include: { project: { select: { title: true, townSlug: true, coverPhotoId: true } } },
        }),
    );
    if (!photo) {
      this.logger.warn(`job ${job.id}: photo ${photoId} no longer exists, nothing to do`);
      return;
    }

    await this.update(job, photoId, { processingStatus: 'processing', processingError: null });
    const started = Date.now();
    try {
      const { grade, brand, og } = await this.settings.getNamespace('projects');
      const ogEnabled = og.enabled;
      const base = { orgId, projectId, photoId, uploadedById: photo.createdById };
      const ids = { orgId, projectId, photoId };

      // 1. enhance (or load the existing master for a crops/og-only run).
      let master: Buffer;
      const update: Prisma.ProjectPhotoUncheckedUpdateInput = {};
      if (stages.has('enhance') || !photo.enhancedObjectId) {
        const original = await this.store.read(photo.originalObjectId, orgId);
        const enhanced = await this.timed('enhance', () => this.runEnhance(original, grade, ids));
        const flags = await assessQuality({ original, enhanced: enhanced.buffer, enhancedLumaMean: enhanced.stats.lumaMean });
        const objectId = await this.store.write({ ...base, name: 'enhanced.jpg', buffer: enhanced.buffer, mimeType: 'image/jpeg' });
        master = enhanced.buffer;
        Object.assign(update, { enhancedObjectId: objectId, width: enhanced.width, height: enhanced.height, dominantColor: enhanced.dominantColor, qualityFlags: flags });
        await this.update(job, photoId, update);
      } else {
        master = await this.store.read(photo.enhancedObjectId, orgId);
      }

      // 2. crops: also after an enhance, whose pixels they are cut from, and when the cover's OG needs a fresh crop.
      const renditions: PhotoRenditions = { ...((photo.renditions as PhotoRenditions | null) ?? {}) };
      const isCover = photo.project.coverPhotoId === photoId;
      const runCrops = stages.has('crops') || stages.has('enhance') || !photo.renditions;
      const runOg = isCover && ogEnabled && (stages.has('og') || runCrops);
      let focal: Focal = { x: photo.focalX, y: photo.focalY };
      let ogCrop: Rendition | undefined;
      if (runCrops) {
        const firstRun = photo.renditions == null && photo.focalX === DEFAULT_FOCAL && photo.focalY === DEFAULT_FOCAL;
        if (firstRun) focal = await findFocalPoint(master);
        const crops = await this.timed('crops', () => this.runCrops(master, focal, ids));
        for (const crop of crops) {
          const objectId = await this.store.write({ ...base, name: `${crop.key}.${crop.ext}`, buffer: crop.buffer, mimeType: crop.mimeType });
          renditions[crop.key] = { objectId, w: crop.width, h: crop.height };
        }
        ogCrop = crops.find((crop) => crop.key === 'og');
        Object.assign(update, { focalX: focal.x, focalY: focal.y, renditions });
      }

      // 3. branded OG, cover photo only.
      if (runOg) {
        const ogSource = ogCrop;
        const branded = await this.timed('og', () => this.runOg(ids, async () => {
          const crop = ogSource ?? (await makeCrop(master, focal, CROP_SPECS.find((spec) => spec.key === 'og')!));
          const logo = brand.logoObjectId ? await this.store.read(brand.logoObjectId, orgId).catch(() => null) : null;
          return renderOgImage({
            crop: crop.buffer,
            title: photo.project.title || brand.businessName,
            town: townName(photo.project.townSlug),
            brand: { navy: brand.navy, gold: brand.gold, businessName: brand.businessName, logo },
          });
        }));
        const objectId = await this.store.write({ ...base, name: 'og-branded.jpg', buffer: branded, mimeType: 'image/jpeg' });
        renditions.ogBranded = { objectId, w: 1200, h: 630 };
        update.renditions = renditions;
      }

      await this.update(job, photoId, { ...update, processingStatus: 'ready', processingError: null });
      this.logger.log(`job ${job.id}: photo ${photoId} processed (${[...stages].join(',')}) in ${Date.now() - started} ms`);
      // After the last write committed; a failure here never fails the job.
      await this.announce({ orgId, projectId, photoId, uploaderId: photo.createdById ?? null, status: 'ok' });
    } catch (error) {
      this.logger.error(`job ${job.id}: photo ${photoId} failed: ${error instanceof Error ? error.message : String(error)}`);
      await this.update(job, photoId, { processingStatus: 'failed', processingError: safeProcessingError(error) }).catch((inner: unknown) =>
        this.logger.warn(`job ${job.id}: could not record the failure: ${inner instanceof Error ? inner.message : String(inner)}`),
      );
      // Only the last attempt tells the uploader: an earlier failure is retried.
      if ((job.attempts ?? 1) >= this.profile.maxAttempts) {
        await this.announce({ orgId, projectId, photoId, uploaderId: photo.createdById ?? null, status: 'failed' });
      }
      throw error;
    }
  }

  /** Times one stage into `projects_photo_process_ms` (result ok or failed), re-throwing a failure. */
  private async timed<T>(stage: PhotoMetricStage, fn: () => Promise<T>): Promise<T> {
    const start = Date.now();
    try {
      const out = await fn();
      this.metrics?.photoStage(stage, 'ok', Date.now() - start);
      return out;
    } catch (error) {
      this.metrics?.photoStage(stage, 'failed', Date.now() - start);
      throw error;
    }
  }

  private async announce(event: Parameters<PhotoEventsPublisher['publishPhotoReady']>[0]): Promise<void> {
    try {
      await this.events?.publishPhotoReady(event);
    } catch (error) {
      this.logger.warn(`the photo ready event failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  @Trace('projects.photo.enhance')
  private runEnhance(original: Buffer, grade: { warmth: number; saturation: number }, ids: SpanIds): Promise<EnhanceResult> {
    setSpanAttributes({ ...ids, rendition: 'master' });
    return enhance(original, grade);
  }

  @Trace('projects.photo.crops')
  private runCrops(master: Buffer, focal: Focal, ids: SpanIds): Promise<Rendition[]> {
    setSpanAttributes(ids);
    return makeCrops(master, focal);
  }

  /** The branded OG composite of the cover photo. */
  @Trace('projects.photo.og')
  private runOg<T>(ids: SpanIds, fn: () => Promise<T>): Promise<T> {
    setSpanAttributes({ ...ids, rendition: 'og-branded' });
    return fn();
  }

  private update(job: Job, photoId: string, data: Prisma.ProjectPhotoUncheckedUpdateInput): Promise<unknown> {
    return this.scope.run<unknown, Prisma.TransactionClient>(job, (tx) => tx.projectPhoto.update({ where: { id: photoId }, data }));
  }
}
