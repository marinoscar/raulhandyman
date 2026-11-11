import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Trace } from '@marinoscar/platform-api/otel-core';

import { PrismaService } from '../prisma/prisma.service';
import { ProjectStorageGateway } from './project-storage.gateway';
import { PhotoProcessingPort } from './projects.ports';
import { normalizeFileSlug, type AddPhotoDto, type ReorderPhotosDto, type UpdatePhotoDto } from './projects.schemas';
import { photoObjectIds, toPhotoView } from './projects.views';
import { SitePublishService } from './site-publish.service';

/** Photos of a project: add, edit, delete, reorder. Same rules as `ProjectsService` (org scope, no private data in logs). */
@Injectable()
export class PhotosService {
  private readonly logger = new Logger(PhotosService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: ProjectStorageGateway,
    private readonly processing: PhotoProcessingPort,
    private readonly site: SitePublishService,
  ) {}

  /** The object must be the caller's, `ready` and an image. The row starts `pending`; the processing job is enqueued after the commit. */
  @Trace('projects.photos.add')
  async add(orgId: string, userId: string, projectId: string, input: AddPhotoDto) {
    const object = await this.storage.describe(input.storageObjectId, userId, orgId);
    if (!object) throw new UnprocessableEntityException('The storage object does not exist or is not yours');
    if (object.status !== 'ready') throw new UnprocessableEntityException('The storage object is not ready yet');
    if (!object.mimeType.toLowerCase().startsWith('image/')) throw new UnprocessableEntityException('The storage object is not an image');

    const row = await this.prisma.runInOrg(
      orgId,
      async (tx) => {
        const project = await tx.project.findFirst({ where: { id: projectId } });
        if (!project) throw new NotFoundException('Project not found');
        if (await tx.projectPhoto.findFirst({ where: { projectId, originalObjectId: input.storageObjectId }, select: { id: true } })) {
          throw new ConflictException('That object is already a photo of this project');
        }
        const last = await tx.projectPhoto.findFirst({ where: { projectId }, orderBy: { sortOrder: 'desc' }, select: { sortOrder: true } });
        const role = input.role ?? 'progress';
        const photo = await tx.projectPhoto.create({
          data: {
            orgId,
            projectId,
            role,
            sortOrder: (last?.sortOrder ?? -1) + 1,
            originalObjectId: input.storageObjectId,
            fileSlug: normalizeFileSlug(object.name.replace(/\.[a-z0-9]+$/i, '')),
            processingStatus: 'pending',
            createdById: userId,
          },
        });
        if (!project.coverPhotoId && role !== 'before') await tx.project.updateMany({ where: { id: projectId }, data: { coverPhotoId: photo.id } });
        if (project.status === 'published') await this.site.recompute(tx, orgId);
        return photo;
      },
      { userId },
    );
    this.logger.log(`project.photo.add projectId=${projectId} photoId=${row.id} userId=${userId}`);
    await this.processing.enqueue({ orgId, projectId, photoId: row.id, userId }, ['analyze', 'enhance', 'crops']);
    return toPhotoView(row);
  }

  @Trace('projects.photos.update')
  async update(orgId: string, userId: string, projectId: string, photoId: string, patch: UpdatePhotoDto) {
    const { row, focalChanged } = await this.prisma.runInOrg(
      orgId,
      async (tx) => {
        const project = await tx.project.findFirst({ where: { id: projectId }, select: { id: true, status: true } });
        if (!project) throw new NotFoundException('Project not found');
        const photo = await tx.projectPhoto.findFirst({ where: { id: photoId, projectId } });
        if (!photo) throw new NotFoundException('Photo not found');

        const role = patch.role ?? photo.role;
        const chosen = patch.chosenVariant ?? photo.chosenVariant;
        if (chosen === 'retouched' && (!photo.retouchedObjectId || role === 'before')) {
          throw new UnprocessableEntityException('A retouched variant needs a retouched image and cannot be used on a before photo');
        }
        const data: Prisma.ProjectPhotoUncheckedUpdateInput = {};
        if (patch.role !== undefined) data.role = patch.role;
        if (patch.altText !== undefined) data.altText = patch.altText;
        if (patch.caption !== undefined) data.caption = patch.caption;
        if (patch.fileSlug !== undefined) data.fileSlug = normalizeFileSlug(patch.fileSlug);
        if (patch.focalX !== undefined) data.focalX = patch.focalX;
        if (patch.focalY !== undefined) data.focalY = patch.focalY;
        if (patch.chosenVariant !== undefined) data.chosenVariant = patch.chosenVariant;
        const focalChanged = (patch.focalX !== undefined && patch.focalX !== photo.focalX) || (patch.focalY !== undefined && patch.focalY !== photo.focalY);

        const updated = await tx.projectPhoto.update({ where: { id: photoId }, data });
        if (project.status === 'published') await this.site.recompute(tx, orgId);
        return { row: updated, focalChanged };
      },
      { userId },
    );
    this.logger.log(`project.photo.update projectId=${projectId} photoId=${photoId} userId=${userId}`);
    if (focalChanged) await this.processing.enqueue({ orgId, projectId, photoId, userId }, ['crops']);
    return toPhotoView(row);
  }

  /** Deletes the row and, after the commit, its storage objects. */
  @Trace('projects.photos.remove')
  async remove(orgId: string, userId: string, projectId: string, photoId: string): Promise<void> {
    const objectIds = await this.prisma.runInOrg(
      orgId,
      async (tx) => {
        const project = await tx.project.findFirst({ where: { id: projectId } });
        if (!project) throw new NotFoundException('Project not found');
        const photo = await tx.projectPhoto.findFirst({ where: { id: photoId, projectId } });
        if (!photo) throw new NotFoundException('Photo not found');
        if (project.coverPhotoId === photoId) await tx.project.updateMany({ where: { id: projectId }, data: { coverPhotoId: null } });
        await tx.projectPhoto.delete({ where: { id: photoId } });
        if (project.status === 'published') await this.site.recompute(tx, orgId);
        return photoObjectIds(photo);
      },
      { userId },
    );
    this.logger.log(`project.photo.delete projectId=${projectId} photoId=${photoId} userId=${userId}`);
    await this.storage.deleteAll(objectIds, userId, orgId);
  }

  /** `photoIds` must be exactly the project's photos (no missing, extra or repeated id). */
  @Trace('projects.photos.reorder')
  async reorder(orgId: string, userId: string, projectId: string, input: ReorderPhotosDto) {
    const rows = await this.prisma.runInOrg(
      orgId,
      async (tx) => {
        const project = await tx.project.findFirst({ where: { id: projectId }, select: { id: true, status: true } });
        if (!project) throw new NotFoundException('Project not found');
        const photos = await tx.projectPhoto.findMany({ where: { projectId }, select: { id: true } });
        const wanted = new Set(input.photoIds);
        if (wanted.size !== input.photoIds.length || photos.length !== wanted.size || photos.some((photo) => !wanted.has(photo.id))) {
          throw new BadRequestException('photoIds must list every photo of the project exactly once');
        }
        for (const [index, id] of input.photoIds.entries()) {
          await tx.projectPhoto.updateMany({ where: { id, projectId }, data: { sortOrder: index } });
        }
        if (project.status === 'published') await this.site.recompute(tx, orgId);
        return tx.projectPhoto.findMany({ where: { projectId }, orderBy: { sortOrder: 'asc' } });
      },
      { userId },
    );
    this.logger.log(`project.photo.reorder projectId=${projectId} userId=${userId}`);
    return rows.map(toPhotoView);
  }
}
