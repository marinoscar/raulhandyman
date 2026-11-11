import { ConflictException, Injectable, Logger, NotFoundException, PreconditionFailedException, UnprocessableEntityException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { Trace } from '@marinoscar/platform-api/otel-core';

import { PrismaService } from '../prisma/prisma.service';
import { ProjectEventsPublisher } from './projects.ports';
import { lintStored, SIBLING_SELECT, toProjectView } from './projects.views';
import { computeContentVersion } from './site-content-version';

type Tx = Prisma.TransactionClient;

/** Recomputes `SitePublishState.contentVersion`, and publishes and unpublishes projects. */
@Injectable()
export class SitePublishService {
  private readonly logger = new Logger(SitePublishService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly events: ProjectEventsPublisher,
  ) {}

  /**
   * Recomputes the organization's content version inside the caller's
   * transaction and stores it (one `SitePublishState` row per organization,
   * upserted). The row is only written when the version CHANGED, so an edit
   * that does not reach the public content leaves it (and `lastPublishedAt`)
   * alone.
   */
  async recompute(tx: Tx, orgId: string): Promise<{ contentVersion: string; changed: boolean }> {
    const contentVersion = await computeContentVersion(tx, orgId);
    const existing = await tx.sitePublishState.findFirst({ where: { orgId }, select: { contentVersion: true } });
    if (existing?.contentVersion === contentVersion) return { contentVersion, changed: false };
    const now = new Date();
    await tx.sitePublishState.upsert({
      where: { orgId },
      create: { orgId, contentVersion, lastPublishedAt: now },
      update: { contentVersion, lastPublishedAt: now },
    });
    return { contentVersion, changed: true };
  }

  /** Lints the project; any error is a 422 listing the codes; otherwise it goes live and the version is recomputed. */
  @Trace('projects.publish')
  async publish(orgId: string, userId: string, id: string, expectedVersion: number) {
    const result = await this.prisma.runInOrg(
      orgId,
      async (tx) => {
        const project = await this.loadForTransition(tx, id, expectedVersion);
        if (project.status === 'archived') throw new ConflictException('Restore the archived project to draft before publishing it');
        const photos = await tx.projectPhoto.findMany({ where: { projectId: id }, orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] });
        const siblings = await tx.project.findMany({ where: { id: { not: id } }, select: SIBLING_SELECT });
        const lint = lintStored(project, photos, siblings);
        if (lint.errors.length > 0) {
          throw new UnprocessableEntityException({
            message: `The project does not meet the SEO requirements: ${lint.errors.map((issue) => issue.code).join(', ')}`,
            details: { errors: lint.errors, warnings: lint.warnings },
          });
        }
        const { count } = await tx.project.updateMany({
          where: { id, version: expectedVersion },
          data: { status: 'published', publishedAt: project.publishedAt ?? new Date(), updatedById: userId, version: { increment: 1 } },
        });
        if (count === 0) throw new ConflictException('The project changed while it was being published');
        const published = await tx.project.findFirstOrThrow({ where: { id } });
        const { contentVersion } = await this.recompute(tx, orgId);
        return { project: published, contentVersion, lint };
      },
      { userId },
    );
    this.logger.log(`project.publish projectId=${id} userId=${userId}`);
    // After the commit and outside any transaction (the notifications rule).
    await this.events.publishPublished({ orgId, projectId: id, slug: result.project.slug, actorUserId: userId });
    return { ...toProjectView(result.project), contentVersion: result.contentVersion, lint: result.lint };
  }

  /** Back to `draft`; the project leaves the manifest and the version is recomputed. */
  @Trace('projects.unpublish')
  async unpublish(orgId: string, userId: string, id: string, expectedVersion: number | undefined) {
    const result = await this.prisma.runInOrg(
      orgId,
      async (tx) => {
        const project = await tx.project.findFirst({ where: { id } });
        if (!project) throw new NotFoundException('Project not found');
        if (expectedVersion !== undefined && project.version !== expectedVersion) {
          throw new PreconditionFailedException(`Stale version: the project is at version ${project.version}`);
        }
        if (project.status !== 'published') throw new ConflictException('The project is not published');
        await tx.project.update({ where: { id }, data: { status: 'draft', updatedById: userId, version: { increment: 1 } } });
        const unpublished = await tx.project.findFirstOrThrow({ where: { id } });
        const { contentVersion } = await this.recompute(tx, orgId);
        return { project: unpublished, contentVersion };
      },
      { userId },
    );
    this.logger.log(`project.unpublish projectId=${id} userId=${userId}`);
    await this.events.publishUnpublished({ orgId, projectId: id, slug: result.project.slug, actorUserId: userId });
    return { ...toProjectView(result.project), contentVersion: result.contentVersion };
  }

  private async loadForTransition(tx: Tx, id: string, expectedVersion: number) {
    const project = await tx.project.findFirst({ where: { id } });
    if (!project) throw new NotFoundException('Project not found');
    if (project.version !== expectedVersion) {
      throw new PreconditionFailedException(`Stale version: the project is at version ${project.version}`);
    }
    return project;
  }
}
