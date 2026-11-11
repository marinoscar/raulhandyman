import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { AiService, type AiInputItem } from '@marinoscar/platform-api/ai';
import { JobHandlerRegistry, JobScope, type Job, type JobHandler } from '@marinoscar/platform-api/jobs';

import { PROJECTS_COPY_FEATURE_ID } from '../../platform/ai/projects-copy.feature';
import { findService, findTown } from '../catalog';
import { ProjectMediaStore } from '../media/project-media.store';
import { AiEventsPublisher } from '../projects.ports';
import { lintStored, SIBLING_SELECT } from '../projects.views';
import type { LintIssue } from '../seo-lint';
import { toSafeAiError } from './ai-errors';
import { pickUsableModel } from './ai-models';
import { AI_RENDITION_KEY, AI_SUGGEST_JOB, MAX_SUGGEST_PHOTOS } from './projects-ai.constants';
import { buildCopySystemPrompt, buildCopyUserText, PROJECTS_COPY_PROMPT_VERSION } from './projects-copy.prompt';
import { copySchemaFor, narrowSchemaFor, REGENERATE_PHOTO_FIELDS, REGENERATE_PROJECT_FIELDS, type PhotoCopy } from './projects-copy.schema';

export const suggestPayloadSchema = z.object({
  orgId: z.uuid(),
  projectId: z.uuid(),
  userId: z.uuid(),
  fields: z.array(z.enum(['project', 'photos'])).min(1),
  photoIds: z.array(z.uuid()).max(50).optional(),
  /** A single-field regenerate (issue #22): `avoid` is the value to differ from. */
  regenerate: z
    .object({
      field: z.enum([...REGENERATE_PROJECT_FIELDS, ...REGENERATE_PHOTO_FIELDS]),
      photoId: z.uuid().optional(),
      avoid: z.string().max(2_000),
    })
    .optional(),
});
export type SuggestPayload = z.infer<typeof suggestPayloadSchema>;

type PhotoRow = Prisma.ProjectPhotoGetPayload<object>;
type Renditions = Record<string, { objectId?: string } | undefined>;

/** The envelope stored on `project.aiSuggestion` / `photo.aiSuggestion`. Never overwrites an editable field. */
export interface StoredSuggestion<T> {
  model: string;
  createdAt: string;
  /** The provider's response id. The queue does not keep an `ai_runs` row for an inline call. */
  runId: string;
  promptVersion: string;
  output: T;
  lintWarnings?: LintIssue[];
}

const asJson = (value: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * `projects.ai.suggest`: reads the project, its notes and up to eight photos
 * (the `ai1024` rendition as a data: URL), asks the model for grounded,
 * SEO-sound copy as a structured output and stores it as a SUGGESTION on
 * `aiSuggestion`. The editable fields are never written here; the editor applies
 * a suggestion explicitly (`POST /api/projects/:id/ai/apply`).
 *
 * Self-registering and SERVER ONLY (AI rule 3): it carries neither
 * `nodeResultSchema` nor `persistNodeResult`, because a worker node must never
 * hold a provider key. One active job per project (the queue dedups on type and
 * subject). A provider rate limit defers the job; any other failure surfaces a
 * user-safe message.
 */
@Injectable()
export class SuggestJobHandler implements JobHandler, OnModuleInit {
  readonly type = AI_SUGGEST_JOB;
  readonly label = 'Suggest project copy';
  readonly profile = { maxRuntimeMs: 120_000, maxAttempts: 2 };
  private readonly logger = new Logger(SuggestJobHandler.name);

  constructor(
    private readonly registry: JobHandlerRegistry,
    private readonly scope: JobScope,
    private readonly ai: AiService,
    private readonly moduleRef: ModuleRef,
    private readonly store: ProjectMediaStore,
    private readonly events: AiEventsPublisher,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async process(job: Job): Promise<void> {
    const payload = suggestPayloadSchema.parse(job.payload);
    if (job.orgId && job.orgId !== payload.orgId) throw new Error(`Job ${job.id} payload organization does not match the job`);
    const { orgId, projectId, userId } = payload;

    const loaded = await this.scope.run<{ project: Prisma.ProjectGetPayload<object>; photos: PhotoRow[]; siblings: Prisma.ProjectGetPayload<{ select: typeof SIBLING_SELECT }>[] } | null, Prisma.TransactionClient>(job, async (tx) => {
      const project = await tx.project.findFirst({ where: { id: projectId, orgId } });
      if (!project) return null;
      return {
        project,
        photos: await tx.projectPhoto.findMany({ where: { projectId, orgId }, orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] }),
        siblings: await tx.project.findMany({ where: { id: { not: projectId }, orgId }, select: SIBLING_SELECT }),
      };
    });
    if (!loaded) {
      this.logger.warn(`job ${job.id}: project ${projectId} no longer exists, nothing to do`);
      return;
    }
    const { project, photos, siblings } = loaded;

    const warnings: string[] = [];
    const chosen = this.choosePhotos(photos, payload);
    const images: Array<{ photoId: string; role: string; altText: string; dataUrl: string }> = [];
    for (const photo of chosen) {
      const objectId = (photo.renditions as Renditions | null)?.[AI_RENDITION_KEY]?.objectId;
      if (!objectId) {
        warnings.push(`A photo was skipped because it is not processed yet.`);
        continue;
      }
      try {
        const bytes = await this.store.read(objectId, orgId);
        images.push({ photoId: photo.id, role: photo.role, altText: photo.altText, dataUrl: `data:image/jpeg;base64,${bytes.toString('base64')}` });
      } catch (error) {
        this.logger.warn(`job ${job.id}: photo ${photo.id} could not be read: ${error instanceof Error ? error.message : String(error)}`);
        warnings.push('A photo was skipped because it could not be read.');
      }
    }

    const service = findService(project.serviceSlug);
    const town = findTown(project.townSlug);
    const text = buildCopyUserText({
      serviceName: service?.seoName ?? project.serviceSlug,
      townName: town?.name ?? project.townSlug,
      title: project.title,
      workNotes: project.workNotes,
      photos: images,
      fields: payload.fields,
      ...(payload.regenerate ? { regenerate: payload.regenerate } : {}),
    });
    const content: Array<{ type: 'text'; text: string } | { type: 'image'; url: string; detail: 'auto' }> = [{ type: 'text', text }];
    images.forEach((image, index) => {
      content.push({ type: 'text', text: `Photo #${index + 1} (photoId ${image.photoId}):` });
      content.push({ type: 'image', url: image.dataUrl, detail: 'auto' });
    });
    const input: AiInputItem[] = [{ type: 'message', role: 'user', content }];

    const schema = payload.regenerate ? narrowSchemaFor(payload.regenerate.field) : copySchemaFor(payload.fields);
    let response;
    try {
      const model = await pickUsableModel(
        this.moduleRef,
        userId,
        orgId,
        (caps) => caps.capabilities.includes('responses') && caps.capabilities.includes('structured_output') && caps.inputModalities.includes('image'),
        'No AI model is enabled for project copy. Ask an administrator to enable one in Admin, AI, Models.',
      );
      response = await this.ai.forUser(userId, { orgId, feature: PROJECTS_COPY_FEATURE_ID }).respondStructured({
        provider: model.provider,
        model: model.modelId,
        instructions: buildCopySystemPrompt(),
        input,
        schema,
        schemaName: 'ProjectCopy',
        strict: true,
      });
    } catch (error) {
      this.logger.error(`job ${job.id}: AI call failed for project ${projectId}: ${error instanceof Error ? error.name : 'error'}`);
      throw toSafeAiError(error);
    }

    const output = response.parsed as Record<string, unknown> & { warnings: string[]; photos?: Array<Partial<PhotoCopy> & { photoId: string }> };
    const sentIds = new Set(images.map((image) => image.photoId));
    const photoOutputs = (output.photos ?? []).filter((photo) => sentIds.has(photo.photoId));
    if ((output.photos?.length ?? 0) !== photoOutputs.length) warnings.push('The AI answered for a photo that was not sent; that answer was dropped.');
    const meta = { model: response.model, createdAt: new Date().toISOString(), runId: response.id, promptVersion: PROJECTS_COPY_PROMPT_VERSION };
    const allWarnings = [...output.warnings, ...warnings];

    await this.scope.run<void, Prisma.TransactionClient>(job, async (tx) => {
      const current = await tx.project.findFirst({ where: { id: projectId, orgId }, select: { aiSuggestion: true } });
      if (!current) return;
      const currentPhotos = new Map((await tx.projectPhoto.findMany({ where: { projectId, orgId } })).map((photo) => [photo.id, photo]));

      if (payload.regenerate) {
        const { field } = payload.regenerate;
        if (payload.regenerate.photoId) {
          const photoId = payload.regenerate.photoId;
          const row = photoOutputs.find((photo) => photo.photoId === photoId);
          const photo = currentPhotos.get(photoId);
          if (!row || !photo || (field !== 'altText' && field !== 'caption')) return;
          const previous = isRecord(photo.aiSuggestion) ? photo.aiSuggestion : null;
          const previousOutput = previous && isRecord(previous.output) ? previous.output : {};
          const next = previous ? { ...previous, output: { ...previousOutput, [field]: row[field] } } : { ...meta, output: { [field]: row[field] } };
          await tx.projectPhoto.update({ where: { id: photoId }, data: { aiSuggestion: asJson(next) } });
          return;
        }
        const keys = field === 'title' ? ['titleOptions'] : [field];
        const previous = isRecord(current.aiSuggestion) ? current.aiSuggestion : null;
        const previousOutput = previous && isRecord(previous.output) ? previous.output : {};
        const merged = { ...previousOutput, ...Object.fromEntries(keys.map((key) => [key, output[key]])) };
        const next = { ...(previous ?? meta), output: merged };
        const lintWarnings = this.lint(project, merged, [...currentPhotos.values()], siblings);
        await tx.project.update({ where: { id: projectId }, data: { aiSuggestion: asJson({ ...next, lintWarnings }) } });
        return;
      }

      if (payload.fields.includes('project')) {
        const stored = { ...Object.fromEntries(Object.entries(output).filter(([key]) => key !== 'photos')), warnings: allWarnings };
        const lintWarnings = this.lint(project, stored, [...currentPhotos.values()], siblings, photoOutputs);
        await tx.project.update({ where: { id: projectId }, data: { aiSuggestion: asJson({ ...meta, output: stored, lintWarnings }) } });
      }
      if (payload.fields.includes('photos')) {
        for (const row of photoOutputs) {
          const { photoId, ...rest } = row;
          if (!currentPhotos.has(photoId)) continue;
          await tx.projectPhoto.update({ where: { id: photoId }, data: { aiSuggestion: asJson({ ...meta, output: rest }) } });
        }
      }
    });

    this.logger.log(`job ${job.id}: suggestion stored for project ${projectId} (${images.length} photos, model ${response.model})`);
    try {
      await this.events.publishSuggestReady({ orgId, projectId, userId, jobId: job.id });
    } catch (error) {
      this.logger.warn(`job ${job.id}: the ready event failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /** At most eight photos by `sortOrder`, narrowed by `photoIds` or the regenerate's photo. */
  private choosePhotos(photos: readonly PhotoRow[], payload: SuggestPayload): PhotoRow[] {
    const wanted = payload.regenerate?.photoId ? [payload.regenerate.photoId] : payload.photoIds;
    const pool = wanted && wanted.length > 0 ? photos.filter((photo) => wanted.includes(photo.id)) : [...photos];
    return pool
      .filter((photo) => photo.processingStatus === 'ready')
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .slice(0, MAX_SUGGEST_PHOTOS);
  }

  /** The shared SEO lint on the project as it would read with the suggestion applied; a suggestion that fails is kept, marked. */
  private lint(
    project: Prisma.ProjectGetPayload<object>,
    output: Record<string, unknown>,
    photos: readonly PhotoRow[],
    siblings: Parameters<typeof lintStored>[2],
    photoOutputs: ReadonlyArray<Partial<PhotoCopy> & { photoId: string }> = [],
  ): LintIssue[] {
    const titleOptions = Array.isArray(output.titleOptions) ? (output.titleOptions as string[]) : [];
    const suggested = {
      ...project,
      title: titleOptions[0] ?? project.title,
      slug: typeof output.slug === 'string' ? output.slug : project.slug,
      seoTitle: typeof output.seoTitle === 'string' ? output.seoTitle : project.seoTitle,
      metaDescription: typeof output.metaDescription === 'string' ? output.metaDescription : project.metaDescription,
      body: typeof output.body === 'string' ? output.body : project.body,
    };
    const merged = photos.map((photo) => {
      const row = photoOutputs.find((candidate) => candidate.photoId === photo.id);
      return row ? { ...photo, altText: row.altText ?? photo.altText, caption: row.caption ?? photo.caption } : photo;
    });
    const result = lintStored(suggested, merged, siblings);
    const fields = new Set(['title', 'slug', 'seoTitle', 'metaDescription', 'body']);
    return [...result.errors, ...result.warnings].filter((issue) => fields.has(issue.field));
  }
}
