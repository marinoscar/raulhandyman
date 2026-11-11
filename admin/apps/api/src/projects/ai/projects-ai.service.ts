import { ConflictException, Injectable, Logger, NotFoundException, PreconditionFailedException, UnprocessableEntityException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { buildDedupKey, JobReason, JobsService, JobStatus } from '@marinoscar/platform-api/jobs';
import { Trace } from '@marinoscar/platform-api/otel-core';

import { setSpanAttributes } from '../events/span-attributes';
import { PrismaService } from '../../prisma/prisma.service';
import { ProjectStorageGateway } from '../project-storage.gateway';
import { normalizeFileSlug } from '../projects.schemas';
import { parseIfMatch } from '../projects.service';
import { lintStored, photoPreviews, renditionObjectIds, SIBLING_SELECT, toPhotoView, toProjectView } from '../projects.views';
import { SLUG_PATTERN } from '../seo-lint';
import { SitePublishService } from '../site-publish.service';
import { AI_SUGGEST_JOB, AI_SUGGEST_SUBJECT_TYPE, PHOTO_RETOUCH_JOB, PHOTO_RETOUCH_SUBJECT_TYPE } from './projects-ai.constants';
import { RetouchNotAllowedException } from './projects-ai.errors';
import type { ApplyBody, RegenerateBody } from './projects-ai.schemas';
import type { SuggestScope } from './projects-copy.schema';
import { RETOUCHED_RENDITION_KEYS, type RetouchPayload } from './retouch.job';
import type { SuggestPayload } from './suggest.job';

const MAX_AVOID_CHARS = 2_000;
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const outputOf = (suggestion: unknown): Record<string, unknown> | null => (isRecord(suggestion) && isRecord(suggestion.output) ? suggestion.output : null);

/**
 * The AI half of the projects API: enqueue a suggestion, a single-field
 * regenerate or a retouch, apply a stored suggestion to the editable fields, and
 * drop a retouched variant. The jobs do the AI calls (`suggest.job.ts`,
 * `retouch.job.ts`); nothing here talks to a provider. Every query runs in
 * `runInOrg`, so another organization's project is a 404.
 */
@Injectable()
export class ProjectsAiService {
  private readonly logger = new Logger(ProjectsAiService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jobs: JobsService,
    private readonly site: SitePublishService,
    private readonly storage: ProjectStorageGateway,
  ) {}

  /** `409` while a suggest job of this project is queued or running (the dedup key `projects.ai.suggest:<projectId>`). */
  @Trace('projects.ai.suggest.enqueue')
  async suggest(orgId: string, userId: string, projectId: string, body: { fields?: SuggestScope[]; photoIds?: string[] }): Promise<{ jobId: string }> {
    setSpanAttributes({ orgId, projectId });
    await this.requireProject(orgId, userId, projectId);
    if (body.photoIds?.length) await this.requirePhotos(orgId, userId, projectId, body.photoIds);
    const payload: SuggestPayload = { orgId, projectId, userId, fields: body.fields ?? ['project', 'photos'], ...(body.photoIds ? { photoIds: body.photoIds } : {}) };
    return this.enqueueSuggest(projectId, orgId, payload);
  }

  /** Enqueues a narrow suggest run: only the key asked for is regenerated and merged. */
  @Trace('projects.ai.regenerate.enqueue')
  async regenerate(orgId: string, userId: string, projectId: string, body: RegenerateBody): Promise<{ jobId: string }> {
    setSpanAttributes({ orgId, projectId });
    const { project, photos } = await this.requireProject(orgId, userId, projectId, true);
    const photoId = body.photoId;
    let current: string;
    let stored: unknown;
    if (photoId) {
      const photo = photos.find((candidate) => candidate.id === photoId);
      if (!photo) throw new NotFoundException('Photo not found');
      current = (body.field === 'caption' ? photo.caption : photo.altText) || '';
      stored = outputOf(photo.aiSuggestion)?.[body.field];
    } else {
      const editable: Record<string, string> = { title: project.title, seoTitle: project.seoTitle, metaDescription: project.metaDescription, summary: project.summary, body: project.body };
      current = editable[body.field] ?? '';
      stored = body.field === 'title' ? outputOf(project.aiSuggestion)?.titleOptions : outputOf(project.aiSuggestion)?.[body.field];
    }
    const storedText = Array.isArray(stored) ? stored.join(' | ') : typeof stored === 'string' ? stored : '';
    const avoid = [current, storedText].filter((value) => value.trim() !== '').join(' | ').slice(0, MAX_AVOID_CHARS);
    const payload: SuggestPayload = {
      orgId,
      projectId,
      userId,
      fields: [photoId ? 'photos' : 'project'],
      ...(photoId ? { photoIds: [photoId] } : {}),
      regenerate: { field: body.field, ...(photoId ? { photoId } : {}), avoid },
    };
    return this.enqueueSuggest(projectId, orgId, payload);
  }

  /** 422 `RETOUCH_NOT_ALLOWED` for a `before` photo, 409 while the photo is not `ready`. */
  @Trace('projects.ai.retouch.enqueue')
  async retouch(orgId: string, userId: string, projectId: string, photoId: string, options: RetouchPayload['options']): Promise<{ jobId: string }> {
    setSpanAttributes({ orgId, projectId, photoId });
    const photo = await this.prisma.runInOrg(
      orgId,
      async (tx) => {
        if (!(await tx.project.findFirst({ where: { id: projectId }, select: { id: true } }))) throw new NotFoundException('Project not found');
        return tx.projectPhoto.findFirst({ where: { id: photoId, projectId } });
      },
      { userId },
    );
    if (!photo) throw new NotFoundException('Photo not found');
    if (photo.role === 'before') throw new RetouchNotAllowedException();
    if (photo.processingStatus !== 'ready' || !photo.enhancedObjectId) throw new ConflictException('The photo is still being processed');
    const payload: RetouchPayload = { orgId, projectId, photoId, userId, options };
    const job = await this.jobs.enqueue({ type: PHOTO_RETOUCH_JOB, reason: JobReason.rerun, subjectType: PHOTO_RETOUCH_SUBJECT_TYPE, subjectId: photoId, orgId, payload });
    this.logger.log(`project.photo.retouch projectId=${projectId} photoId=${photoId} userId=${userId} jobId=${job.id}`);
    return { jobId: job.id };
  }

  /**
   * Copies values from the stored suggestions into the editable fields in one
   * transaction and bumps the version. `409` without a stored suggestion (or
   * without the asked-for value in it), `412` on a stale version. A slug on a
   * published project keeps the old one in `previousSlugs`; applying `before`
   * to a photo whose chosen variant is `retouched` falls back to `enhanced`.
   */
  @Trace('projects.ai.apply')
  async apply(orgId: string, userId: string, projectId: string, body: ApplyBody, ifMatch: string | undefined) {
    setSpanAttributes({ orgId, projectId });
    const expected = parseIfMatch(ifMatch);
    const result = await this.prisma.runInOrg(
      orgId,
      async (tx) => {
        const current = await tx.project.findFirst({ where: { id: projectId } });
        if (!current) throw new NotFoundException('Project not found');
        if (current.version !== expected) throw new PreconditionFailedException(`Stale version: the project is at version ${current.version}`);

        const data: Prisma.ProjectUncheckedUpdateManyInput = { updatedById: userId, version: { increment: 1 } };
        if (body.project?.length) {
          const output = outputOf(current.aiSuggestion);
          if (!output) throw new ConflictException('There is no AI suggestion to apply. Generate one first.');
          const text = (key: string): string => {
            const value = output[key];
            if (typeof value !== 'string') throw new ConflictException(`The stored suggestion has no ${key}.`);
            return value;
          };
          for (const field of new Set(body.project)) {
            if (field === 'title') {
              const options = output.titleOptions;
              const option = Array.isArray(options) ? options[body.titleOption ?? 0] : undefined;
              if (typeof option !== 'string') throw new ConflictException('The stored suggestion has no title options.');
              data.title = option;
            } else if (field === 'slug') {
              const slug = text('slug');
              if (!SLUG_PATTERN.test(slug) || slug.length < 3 || slug.length > 70) throw new UnprocessableEntityException('The suggested slug is not valid');
              if (slug !== current.slug) {
                const taken = await tx.project.findFirst({ where: { id: { not: projectId }, OR: [{ slug }, { previousSlugs: { has: slug } }] }, select: { id: true } });
                if (taken) throw new ConflictException('That slug is already used by another project');
                data.slug = slug;
                const previous = current.status === 'published' ? [...current.previousSlugs, current.slug] : [...current.previousSlugs];
                data.previousSlugs = [...new Set(previous)].filter((candidate) => candidate !== slug);
              }
            } else {
              data[field] = text(field);
            }
          }
        }

        for (const request of body.photos ?? []) {
          const photo = await tx.projectPhoto.findFirst({ where: { id: request.photoId, projectId } });
          if (!photo) throw new NotFoundException('Photo not found');
          const output = outputOf(photo.aiSuggestion);
          if (!output) throw new ConflictException('There is no AI suggestion for that photo. Generate one first.');
          const patch: Prisma.ProjectPhotoUncheckedUpdateInput = {};
          for (const field of new Set(request.fields)) {
            if (field === 'role') {
              const role = output.suggestedRole;
              if (role !== 'before' && role !== 'after' && role !== 'progress' && role !== 'detail') throw new ConflictException('The stored suggestion has no role.');
              patch.role = role;
              // The guard of the retouch feature: a before photo never ends up on its retouched variant.
              if (role === 'before' && photo.chosenVariant === 'retouched') patch.chosenVariant = 'enhanced';
            } else {
              const value = output[field];
              if (typeof value !== 'string') throw new ConflictException(`The stored suggestion has no ${field}.`);
              patch[field] = field === 'fileSlug' ? normalizeFileSlug(value) : value;
            }
          }
          await tx.projectPhoto.update({ where: { id: photo.id }, data: patch });
        }

        const { count } = await tx.project.updateMany({ where: { id: projectId, version: expected }, data });
        if (count === 0) throw new PreconditionFailedException('The project changed while it was being saved');
        const updated = await tx.project.findFirstOrThrow({ where: { id: projectId } });
        const photos = await tx.projectPhoto.findMany({ where: { projectId }, orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] });
        const siblings = await tx.project.findMany({ where: { id: { not: projectId } }, select: SIBLING_SELECT });
        if (updated.status === 'published') await this.site.recompute(tx, orgId);
        return { project: updated, photos, lint: lintStored(updated, photos, siblings) };
      },
      { userId },
    ).catch((error: unknown) => {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw new ConflictException('That slug is already used by another project');
      throw error;
    });
    this.logger.log(`project.ai.apply projectId=${projectId} userId=${userId}`);
    const sign = (objectId: string) => this.storage.previewUrl(objectId, userId, orgId);
    const photos = await Promise.all(result.photos.map(async (photo) => ({ ...toPhotoView(photo), previews: await photoPreviews(photo, sign) })));
    return { ...toProjectView(result.project), aiSuggestion: result.project.aiSuggestion ?? null, photos, lint: result.lint };
  }

  /** Removes the retouched variant and its objects; a photo that was set to `retouched` falls back to `enhanced`. */
  @Trace('projects.ai.retouch.remove')
  async removeRetouch(orgId: string, userId: string, projectId: string, photoId: string) {
    setSpanAttributes({ orgId, projectId, photoId });
    const { row, objectIds } = await this.prisma.runInOrg(
      orgId,
      async (tx) => {
        const project = await tx.project.findFirst({ where: { id: projectId }, select: { id: true, status: true } });
        if (!project) throw new NotFoundException('Project not found');
        const photo = await tx.projectPhoto.findFirst({ where: { id: photoId, projectId } });
        if (!photo) throw new NotFoundException('Photo not found');
        const renditions = isRecord(photo.renditions) ? { ...photo.renditions } : null;
        const retouchedKeys = new Set<string>(Object.values(RETOUCHED_RENDITION_KEYS));
        const removed = renditions ? Object.fromEntries(Object.entries(renditions).filter(([key]) => retouchedKeys.has(key))) : {};
        if (renditions) for (const key of retouchedKeys) delete renditions[key];
        const updated = await tx.projectPhoto.update({
          where: { id: photoId },
          data: {
            retouchedObjectId: null,
            aiRetouched: false,
            ...(photo.chosenVariant === 'retouched' ? { chosenVariant: 'enhanced' as const } : {}),
            ...(renditions ? { renditions: renditions as Prisma.InputJsonValue } : {}),
          },
        });
        if (project.status === 'published') await this.site.recompute(tx, orgId);
        return { row: updated, objectIds: [...(photo.retouchedObjectId ? [photo.retouchedObjectId] : []), ...renditionObjectIds(removed)] };
      },
      { userId },
    );
    this.logger.log(`project.photo.retouch.remove projectId=${projectId} photoId=${photoId} userId=${userId}`);
    await this.storage.deleteAll(objectIds, userId, orgId);
    return { ...toPhotoView(row), previews: await photoPreviews(row, (objectId) => this.storage.previewUrl(objectId, userId, orgId)) };
  }

  private async enqueueSuggest(projectId: string, orgId: string, payload: SuggestPayload): Promise<{ jobId: string }> {
    const dedupKey = buildDedupKey(AI_SUGGEST_JOB, AI_SUGGEST_SUBJECT_TYPE, projectId);
    const active = await this.prisma.job.findFirst({ where: { dedupKey, status: { in: [JobStatus.pending, JobStatus.running] } }, select: { id: true } });
    if (active) throw new ConflictException('A suggestion for this project is already running');
    const job = await this.jobs.enqueue({ type: AI_SUGGEST_JOB, reason: JobReason.rerun, subjectType: AI_SUGGEST_SUBJECT_TYPE, subjectId: projectId, orgId, payload });
    this.logger.log(`project.ai.suggest projectId=${projectId} userId=${payload.userId} jobId=${job.id}`);
    return { jobId: job.id };
  }

  private async requireProject(orgId: string, userId: string, projectId: string, withPhotos = false) {
    return this.prisma.runInOrg(
      orgId,
      async (tx) => {
        const project = await tx.project.findFirst({ where: { id: projectId } });
        if (!project) throw new NotFoundException('Project not found');
        return { project, photos: withPhotos ? await tx.projectPhoto.findMany({ where: { projectId } }) : [] };
      },
      { userId },
    );
  }

  private async requirePhotos(orgId: string, userId: string, projectId: string, photoIds: readonly string[]): Promise<void> {
    const ids = [...new Set(photoIds)];
    const found = await this.prisma.runInOrg(orgId, (tx) => tx.projectPhoto.findMany({ where: { projectId, id: { in: ids } }, select: { id: true } }), { userId });
    if (found.length !== ids.length) throw new NotFoundException('Photo not found');
  }
}
