import { ConflictException, HttpException, Injectable, Logger, NotFoundException, PreconditionFailedException, BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Trace } from '@marinoscar/platform-api/otel-core';

import { PrismaService } from '../prisma/prisma.service';
import { CATALOG, type Catalog } from './catalog';
import { ProjectStorageGateway } from './project-storage.gateway';
import { baseSlug, type CreateProjectDto, type ListProjectsQueryDto, type UpdateProjectDto } from './projects.schemas';
import { SitePublishService } from './site-publish.service';
import { lintStored, photoObjectIds, renditionObjectIds, SIBLING_SELECT, toPhotoView, toProjectView } from './projects.views';

const MAX_SLUG_ATTEMPTS = 50;

/** Parses `If-Match: 3`, `"3"` or `W/"3"`; anything else is not a version. */
export function parseIfMatch(header: string | undefined): number {
  if (header === undefined || header.trim() === '') throw new PreconditionFailedException('If-Match header with the current version is required');
  const version = Number.parseInt(header.replace(/^W\//, '').replace(/"/g, ''), 10);
  if (!Number.isInteger(version)) throw new PreconditionFailedException('If-Match must be the project version');
  return version;
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

/**
 * Projects CRUD. Every query runs in `runInOrg(orgId, ...)`, the organization's
 * transaction-local row-level-security scope: another organization's project is
 * a 404, never a 403. `workNotes` is private and is never logged. A mutation
 * logs one line (`projectId`, `userId`, action).
 */
@Injectable()
export class ProjectsService {
  private readonly logger = new Logger(ProjectsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: ProjectStorageGateway,
    private readonly site: SitePublishService,
  ) {}

  catalog(): Catalog {
    return CATALOG;
  }

  @Trace('projects.list')
  async list(orgId: string, userId: string, query: ListProjectsQueryDto) {
    const where: Prisma.ProjectWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.service ? { serviceSlug: query.service } : {}),
      ...(query.q
        ? { OR: [{ title: { contains: query.q, mode: 'insensitive' } }, { slug: { contains: query.q, mode: 'insensitive' } }, { summary: { contains: query.q, mode: 'insensitive' } }] }
        : {}),
    };
    const { rows, total } = await this.prisma.runInOrg(
      orgId,
      async (tx) => ({
        rows: await tx.project.findMany({ where, orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }], skip: (query.page - 1) * query.pageSize, take: query.pageSize }),
        total: await tx.project.count({ where }),
      }),
      { userId },
    );
    return { items: rows.map(toProjectView), page: query.page, pageSize: query.pageSize, total, totalPages: Math.max(1, Math.ceil(total / query.pageSize)) };
  }

  @Trace('projects.create')
  async create(orgId: string, userId: string, input: CreateProjectDto) {
    const base = baseSlug(input.title, input.serviceSlug, input.townSlug, new Date());
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        const row = await this.prisma.runInOrg(
          orgId,
          async (tx) => {
            const slug = await this.uniqueSlug(tx, base);
            return tx.project.create({
              data: {
                orgId,
                slug,
                serviceSlug: input.serviceSlug,
                townSlug: input.townSlug,
                title: input.title ?? '',
                workNotes: input.workNotes ?? '',
                createdById: userId,
                updatedById: userId,
              },
            });
          },
          { userId },
        );
        this.logger.log(`project.create projectId=${row.id} userId=${userId}`);
        return toProjectView(row);
      } catch (error) {
        // A concurrent create took the slug between the check and the insert: pick the next one.
        if (!isUniqueViolation(error)) throw error;
      }
    }
    throw new ConflictException('Could not allocate a unique slug, try again');
  }

  /** The project with its sorted photos (and a signed preview URL per rendition) and its SEO lint. */
  @Trace('projects.get')
  async get(orgId: string, userId: string, id: string) {
    const { project, photos, siblings } = await this.prisma.runInOrg(
      orgId,
      async (tx) => {
        const project = await tx.project.findFirst({ where: { id } });
        if (!project) throw new NotFoundException('Project not found');
        return {
          project,
          photos: await tx.projectPhoto.findMany({ where: { projectId: id }, orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] }),
          siblings: await tx.project.findMany({ where: { id: { not: id } }, select: SIBLING_SELECT }),
        };
      },
      { userId },
    );
    const photoViews = await Promise.all(
      photos.map(async (photo) => ({ ...toPhotoView(photo), previews: await this.previewsOf(photo, userId, orgId) })),
    );
    return { ...toProjectView(project), photos: photoViews, lint: lintStored(project, photos, siblings) };
  }

  @Trace('projects.update')
  async update(orgId: string, userId: string, id: string, patch: UpdateProjectDto, ifMatch: string | undefined) {
    const expected = parseIfMatch(ifMatch);
    const row = await this.prisma.runInOrg(
      orgId,
      async (tx) => {
        const current = await tx.project.findFirst({ where: { id } });
        if (!current) throw new NotFoundException('Project not found');
        if (current.version !== expected) throw new PreconditionFailedException(`Stale version: the project is at version ${current.version}`);

        const data: Prisma.ProjectUncheckedUpdateManyInput = { updatedById: userId, version: { increment: 1 } };
        for (const key of ['title', 'workNotes', 'summary', 'body', 'seoTitle', 'metaDescription', 'featured', 'serviceSlug', 'townSlug'] as const) {
          if (patch[key] !== undefined) (data as Record<string, unknown>)[key] = patch[key];
        }
        if (patch.completedOn !== undefined) data.completedOn = patch.completedOn === null ? null : new Date(`${patch.completedOn}T00:00:00.000Z`);
        if (patch.status !== undefined) {
          if (current.status === 'published') throw new ConflictException('Unpublish the project before changing its status');
          data.status = patch.status;
        }
        if (patch.coverPhotoId !== undefined) {
          if (patch.coverPhotoId !== null && !(await tx.projectPhoto.findFirst({ where: { id: patch.coverPhotoId, projectId: id } }))) {
            throw new BadRequestException("The cover photo must be one of the project's photos");
          }
          data.coverPhotoId = patch.coverPhotoId;
        }
        if (patch.slug !== undefined && patch.slug !== current.slug) {
          const taken = await tx.project.findFirst({ where: { id: { not: id }, OR: [{ slug: patch.slug }, { previousSlugs: { has: patch.slug } }] }, select: { id: true } });
          if (taken) throw new ConflictException('That slug is already used by another project');
          data.slug = patch.slug;
          // A published URL keeps redirecting: the old slug is remembered. The new slug is no longer "previous".
          const previous = current.status === 'published' ? [...current.previousSlugs, current.slug] : [...current.previousSlugs];
          data.previousSlugs = [...new Set(previous)].filter((slug) => slug !== patch.slug);
        }

        const { count } = await tx.project.updateMany({ where: { id, version: expected }, data });
        if (count === 0) throw new PreconditionFailedException('The project changed while it was being saved');
        const updated = await tx.project.findFirstOrThrow({ where: { id } });
        if (updated.status === 'published') await this.site.recompute(tx, orgId);
        return updated;
      },
      { userId },
    ).catch((error: unknown) => {
      if (isUniqueViolation(error)) throw new ConflictException('That slug is already used by another project');
      throw error;
    });
    this.logger.log(`project.update projectId=${id} userId=${userId} fields=${Object.keys(patch).join(',')}`);
    return toProjectView(row);
  }

  /** Only `draft` and `archived` projects; a published one must be unpublished first (409). Deletes the photos' storage objects. */
  @Trace('projects.remove')
  async remove(orgId: string, userId: string, id: string): Promise<void> {
    const objectIds = await this.prisma.runInOrg(
      orgId,
      async (tx) => {
        const project = await tx.project.findFirst({ where: { id } });
        if (!project) throw new NotFoundException('Project not found');
        if (project.status === 'published') throw new ConflictException('Unpublish the project before deleting it');
        const photos = await tx.projectPhoto.findMany({ where: { projectId: id } });
        await tx.project.delete({ where: { id } });
        return photos.flatMap((photo) => photoObjectIds(photo));
      },
      { userId },
    );
    this.logger.log(`project.delete projectId=${id} userId=${userId}`);
    await this.storage.deleteAll(objectIds, userId, orgId);
  }

  /** `base`, then `base-2`, `base-3`, ... the first not used by a slug or a previous slug in the organization. */
  async uniqueSlug(tx: Pick<Prisma.TransactionClient, 'project'>, base: string): Promise<string> {
    for (let n = 1; n <= MAX_SLUG_ATTEMPTS; n++) {
      const suffix = n === 1 ? '' : `-${n}`;
      const candidate = `${base.slice(0, 70 - suffix.length).replace(/-+$/g, '')}${suffix}`;
      const taken = await tx.project.findFirst({ where: { OR: [{ slug: candidate }, { previousSlugs: { has: candidate } }] }, select: { id: true } });
      if (!taken) return candidate;
    }
    throw new HttpException('Could not allocate a unique slug', 409);
  }

  private async previewsOf(photo: Prisma.ProjectPhotoGetPayload<object>, userId: string, orgId: string): Promise<Record<string, string | null>> {
    const wanted: Record<string, string | null | undefined> = {
      original: photo.originalObjectId,
      enhanced: photo.enhancedObjectId,
      retouched: photo.retouchedObjectId,
    };
    if (photo.renditions && typeof photo.renditions === 'object') {
      for (const [name, entry] of Object.entries(photo.renditions as Record<string, unknown>)) {
        wanted[name] = renditionObjectIds({ [name]: entry })[0];
      }
    }
    const entries = await Promise.all(
      Object.entries(wanted)
        .filter((entry): entry is [string, string] => typeof entry[1] === 'string')
        .map(async ([name, objectId]) => [name, await this.storage.previewUrl(objectId, userId, orgId)] as const),
    );
    return Object.fromEntries(entries);
  }
}
