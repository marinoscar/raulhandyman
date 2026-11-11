import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import type { Prisma } from '@prisma/client';
import sharp from 'sharp';
import { z } from 'zod';
import { AiService } from '@marinoscar/platform-api/ai';
import { JobHandlerRegistry, JobScope, type Job, type JobHandler } from '@marinoscar/platform-api/jobs';
import { SystemSettingsService } from '@marinoscar/platform-api/settings';

import { PROJECTS_RETOUCH_FEATURE_ID } from '../../platform/ai/projects-retouch.feature';
import { makeCrops, type CropKey } from '../media/photo-crops';
import { enhance } from '../media/photo-enhance';
import { ProjectMediaStore } from '../media/project-media.store';
import { AiEventsPublisher } from '../projects.ports';
import { SafeJobError, toSafeAiError } from './ai-errors';
import { pickUsableModel, type PickedModel } from './ai-models';
import { RETOUCH_NOT_ALLOWED_MESSAGE } from './projects-ai.errors';
import { PHOTO_RETOUCH_JOB } from './projects-ai.constants';
import { buildRetouchPrompt, DEFAULT_RETOUCH_OPTIONS } from './projects-retouch.prompt';

export const retouchOptionsSchema = z.object({
  declutter: z.boolean().default(true),
  evenLighting: z.boolean().default(true),
  straighten: z.boolean().default(true),
});

export const retouchPayloadSchema = z.object({
  orgId: z.uuid(),
  projectId: z.uuid(),
  photoId: z.uuid(),
  userId: z.uuid(),
  options: retouchOptionsSchema.default(DEFAULT_RETOUCH_OPTIONS),
});
export type RetouchPayload = z.infer<typeof retouchPayloadSchema>;

/** The crops of a retouched photo, stored next to the photo's own renditions under these keys. */
export const RETOUCHED_RENDITION_KEYS: Readonly<Record<CropKey, string>> = {
  card4x3: 'retouchedCard4x3',
  hero16x9: 'retouchedHero16x9',
  thumb: 'retouchedThumb',
  og: 'retouchedOg',
};
const CROP_KEYS: readonly CropKey[] = ['card4x3', 'hero16x9', 'thumb', 'og'];

/** The size the image model works at: 1536x1024 or 1024x1536 by orientation, 1024x1024 for a near-square photo. */
export function retouchCanvas(width: number, height: number): { width: number; height: number; size: string } {
  const ratio = width / height;
  if (ratio > 1.2) return { width: 1536, height: 1024, size: '1536x1024' };
  if (ratio < 1 / 1.2) return { width: 1024, height: 1536, size: '1024x1536' };
  return { width: 1024, height: 1024, size: '1024x1024' };
}

/**
 * `projects.photo.retouch`: a generative cleanup of one photo (loose clutter,
 * harsh exposure) that never changes the work shown. NEVER runs on a `before`
 * photo: the route refuses it (422 `RETOUCH_NOT_ALLOWED`) and this job checks
 * again, at the start and again before it writes, because the role can change
 * while it is queued or running.
 *
 * The model's output goes through the SAME `enhance` and `makeCrops` as an
 * upload (metadata stripped, the photo's own focal point). It sets
 * `retouchedObjectId` and `aiRetouched` and leaves `chosenVariant` alone: the
 * editor picks the variant after comparing.
 *
 * Self-registering and SERVER ONLY (AI rule 3): neither `nodeResultSchema` nor
 * `persistNodeResult`.
 */
@Injectable()
export class RetouchJobHandler implements JobHandler, OnModuleInit {
  readonly type = PHOTO_RETOUCH_JOB;
  readonly label = 'Retouch project photo';
  readonly profile = { maxRuntimeMs: 180_000, maxAttempts: 2 };
  private readonly logger = new Logger(RetouchJobHandler.name);

  constructor(
    private readonly registry: JobHandlerRegistry,
    private readonly scope: JobScope,
    private readonly ai: AiService,
    private readonly moduleRef: ModuleRef,
    private readonly store: ProjectMediaStore,
    private readonly settings: SystemSettingsService,
    private readonly events: AiEventsPublisher,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async process(job: Job): Promise<void> {
    const payload = retouchPayloadSchema.parse(job.payload);
    if (job.orgId && job.orgId !== payload.orgId) throw new Error(`Job ${job.id} payload organization does not match the job`);
    const { orgId, projectId, photoId, userId } = payload;

    const photo = await this.loadPhoto(job, payload);
    if (!photo) {
      this.logger.warn(`job ${job.id}: photo ${photoId} no longer exists, nothing to do`);
      return;
    }
    if (photo.role === 'before') throw new SafeJobError(RETOUCH_NOT_ALLOWED_MESSAGE);
    if (!photo.enhancedObjectId) throw new SafeJobError('The photo is not processed yet. Try again once it is ready.');

    const master = await this.store.read(photo.enhancedObjectId, orgId);
    const canvas = retouchCanvas(photo.width ?? 1, photo.height ?? 1);
    const source = await sharp(master).resize(canvas.width, canvas.height, { fit: 'inside', withoutEnlargement: true }).png().toBuffer();

    const model = await this.pickImageModel(userId, orgId);
    let edited: Buffer;
    try {
      const result = await this.ai.forUser(userId, { orgId, feature: PROJECTS_RETOUCH_FEATURE_ID }).editImageInline({
        provider: model.provider,
        model: model.modelId,
        prompt: buildRetouchPrompt(payload.options),
        images: [{ data: source, mimeType: 'image/png', filename: 'photo.png' }],
        size: canvas.size,
        outputFormat: 'png',
        n: 1,
      });
      const image = result.images[0];
      if (!image) throw new SafeJobError('The AI returned no image. Try again.');
      edited = Buffer.from(image.data);
    } catch (error) {
      this.logger.error(`job ${job.id}: retouch call failed for photo ${photoId}: ${error instanceof Error ? error.name : 'error'}`);
      throw toSafeAiError(error);
    }

    // The same pipeline as an upload: metadata stripped, graded, cut around the photo's focal point.
    const { grade } = await this.settings.getNamespace('projects');
    const retouchedMaster = await enhance(edited, grade);
    const crops = await makeCrops(retouchedMaster.buffer, { x: photo.focalX, y: photo.focalY }, CROP_KEYS);

    // The role may have been flipped to "before" while the model worked: re-check before anything is stored.
    const latest = await this.loadPhoto(job, payload);
    if (!latest) return;
    if (latest.role === 'before') throw new SafeJobError(RETOUCH_NOT_ALLOWED_MESSAGE);

    const base = { orgId, projectId, photoId, uploadedById: photo.createdById };
    const retouchedObjectId = await this.store.write({ ...base, name: 'retouched.jpg', buffer: retouchedMaster.buffer, mimeType: 'image/jpeg' });
    const entries: Record<string, { objectId: string; w: number; h: number }> = {};
    for (const crop of crops) {
      const objectId = await this.store.write({ ...base, name: `retouched-${crop.key}.${crop.ext}`, buffer: crop.buffer, mimeType: crop.mimeType });
      entries[RETOUCHED_RENDITION_KEYS[crop.key as CropKey]] = { objectId, w: crop.width, h: crop.height };
    }

    await this.scope.run<void, Prisma.TransactionClient>(job, async (tx) => {
      const current = await tx.projectPhoto.findFirst({ where: { id: photoId, projectId, orgId }, select: { role: true, renditions: true } });
      if (!current) return;
      if (current.role === 'before') throw new SafeJobError(RETOUCH_NOT_ALLOWED_MESSAGE);
      const renditions = { ...((current.renditions as Record<string, unknown> | null) ?? {}), ...entries };
      // `chosenVariant` is deliberately NOT touched: the editor picks it after comparing.
      await tx.projectPhoto.update({ where: { id: photoId }, data: { retouchedObjectId, aiRetouched: true, renditions: renditions as Prisma.InputJsonValue } });
    });

    this.logger.log(`job ${job.id}: photo ${photoId} retouched with ${model.modelId}`);
    try {
      await this.events.publishRetouchReady({ orgId, projectId, userId, photoId, jobId: job.id });
    } catch (error) {
      this.logger.warn(`job ${job.id}: the ready event failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private loadPhoto(job: Job, payload: RetouchPayload) {
    return this.scope.run<Prisma.ProjectPhotoGetPayload<object> | null, Prisma.TransactionClient>(job, (tx) =>
      tx.projectPhoto.findFirst({ where: { id: payload.photoId, projectId: payload.projectId, orgId: payload.orgId } }),
    );
  }

  /** The image-editing model the administrator enabled (a `gpt-image` family model first). */
  private pickImageModel(userId: string, orgId: string): Promise<PickedModel> {
    return pickUsableModel(
      this.moduleRef,
      userId,
      orgId,
      (caps) => caps.capabilities.includes('image_edit'),
      'No image-editing model is enabled. Ask an administrator to enable one in Admin, AI, Models.',
    );
  }
}
