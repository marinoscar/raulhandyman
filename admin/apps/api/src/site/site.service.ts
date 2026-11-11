import { Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { Trace } from '@marinoscar/platform-api/otel-core';
import { createHash } from 'node:crypto';

import { ProjectsMetrics } from '../projects/events/projects.metrics';
import { setSpanAttributes } from '../projects/events/span-attributes';
import { PrismaService } from '../prisma/prisma.service';
import { findTown } from '../projects/catalog';
import { computeContentVersion } from '../projects/site-content-version';
import { IndexNowKeyService } from './indexnow-key.service';
import { mediaPath, SiteMediaService, type MediaFile, type MediaPhoto } from './site-media.service';
import { siteManifestSchema, type ManifestPhoto, type ManifestProject, type SiteManifest, type SiteMediaRendition } from './site-manifest.schema';
import { SiteEventsPublisher, SitePingPort } from './site.ports';
import type { BuildStatus } from './site.schemas';

/**
 * Only these columns are read: `workNotes`, `aiSuggestion`, user ids and storage
 * keys are never selected, so they cannot reach the manifest even by mistake
 * (and the strict Zod schema would reject them if they did).
 */
const MANIFEST_SELECT = {
  id: true,
  slug: true,
  previousSlugs: true,
  title: true,
  seoTitle: true,
  metaDescription: true,
  summary: true,
  body: true,
  serviceSlug: true,
  townSlug: true,
  completedOn: true,
  featured: true,
  coverPhotoId: true,
  publishedAt: true,
  updatedAt: true,
  photos: {
    orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    select: {
      id: true,
      sortOrder: true,
      role: true,
      altText: true,
      caption: true,
      fileSlug: true,
      focalX: true,
      focalY: true,
      width: true,
      height: true,
      dominantColor: true,
      chosenVariant: true,
      originalObjectId: true,
      enhancedObjectId: true,
      retouchedObjectId: true,
      renditions: true,
      processingStatus: true,
    },
  },
} satisfies Prisma.ProjectSelect;

type ProjectRow = Prisma.ProjectGetPayload<{ select: typeof MANIFEST_SELECT }>;
type PhotoRow = ProjectRow['photos'][number];

const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const FILE_RENDITIONS = ['master', 'card4x3', 'hero16x9'] as const;
const titleCase = (slug: string): string =>
  slug
    .split('-')
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');

/** The manifest's ETag: the content version, plus a short key fingerprint so changing the IndexNow key is not hidden by a 304. */
export function manifestEtag(contentVersion: string, indexNowKey: string | null): string {
  const suffix = indexNowKey ? `-${createHash('sha256').update(indexNowKey).digest('hex').slice(0, 8)}` : '';
  return `"${contentVersion}${suffix}"`;
}

/** True when an `If-None-Match` header names the ETag (`*`, a list, weak prefixes included). */
export function etagMatches(header: string | undefined, etag: string): boolean {
  if (!header) return false;
  if (header.trim() === '*') return true;
  const bare = (value: string) => value.trim().replace(/^W\//, '');
  return header.split(',').some((candidate) => bare(candidate) === bare(etag));
}

export interface SiteStatusView {
  contentVersion: string;
  lastBuildVersion: string | null;
  lastBuildAt: string | null;
  lastBuildStatus: string | null;
  lastBuildError: string | null;
  lastPing: { at: string | null; status: string | null; error: string | null; urlCount: number | null };
}

/**
 * The published-content API behind the static site build: the manifest, its
 * version, rendition bytes and the build-status report. Everything runs inside
 * `runInOrg` for the caller's organization.
 */
@Injectable()
export class SiteService {
  private readonly logger = new Logger(SiteService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly media: SiteMediaService,
    private readonly indexNow: IndexNowKeyService,
    private readonly events: SiteEventsPublisher,
    private readonly ping: SitePingPort,
    @Optional() private readonly metrics?: ProjectsMetrics,
  ) {}

  /** The content version (the same value `SitePublishState.contentVersion` holds). */
  contentVersion(orgId: string): Promise<string> {
    return this.prisma.runInOrg(orgId, (tx) => computeContentVersion(tx, orgId));
  }

  /**
   * The manifest, or `null` when the caller's `If-None-Match` already names the
   * current version (answered before the heavy part is built).
   */
  async getContent(orgId: string, ifNoneMatch: string | undefined): Promise<{ etag: string; manifest: SiteManifest | null }> {
    const [version, key] = await Promise.all([this.contentVersion(orgId), this.indexNow.get()]);
    const etag = manifestEtag(version, key);
    if (etagMatches(ifNoneMatch, etag)) return { etag, manifest: null };
    const manifest = await this.buildManifest(orgId);
    return { etag: manifestEtag(manifest.contentVersion, manifest.indexNowKey ?? null), manifest };
  }

  /**
   * Builds the manifest of the organization's PUBLISHED projects and validates it
   * with the shared Zod schema before returning it, so the contract cannot drift.
   * A photo whose renditions are not ready yet is left out (with a warning); a
   * project left with no usable photo or no OG image is left out too.
   */
  @Trace('site.manifest.build')
  async buildManifest(orgId: string): Promise<SiteManifest> {
    setSpanAttributes({ orgId });
    const { contentVersion, projects } = await this.prisma.runInOrg(orgId, async (tx) => ({
      contentVersion: await computeContentVersion(tx, orgId),
      projects: await tx.project.findMany({ where: { orgId, status: 'published' }, select: MANIFEST_SELECT, orderBy: [{ publishedAt: 'asc' }, { id: 'asc' }] }),
    }));
    const indexNowKey = await this.indexNow.get();

    const out: ManifestProject[] = [];
    for (const project of projects) {
      const built = await this.toManifestProject(orgId, project);
      if (built) out.push(built);
    }

    const liveSlugs = new Set(projects.map((project) => project.slug));
    const seen = new Set<string>();
    const redirects: SiteManifest['redirects'] = [];
    for (const project of projects) {
      for (const old of project.previousSlugs) {
        if (liveSlugs.has(old) || seen.has(old) || !/^[a-z0-9-]+$/.test(old)) continue;
        seen.add(old);
        redirects.push({ from: `/projects/${old}/`, to: `/projects/${project.slug}/` });
      }
    }

    return siteManifestSchema.parse({
      manifestVersion: 1,
      contentVersion,
      generatedAt: new Date().toISOString(),
      indexNowKey,
      projects: out,
      redirects,
    });
  }

  private async toManifestProject(orgId: string, project: ProjectRow): Promise<ManifestProject | null> {
    const usable = project.photos.filter((photo) => this.isUsable(photo));
    if (usable.length < project.photos.length) {
      this.logger.warn(`project ${project.id}: ${project.photos.length - usable.length} photo(s) not ready, left out of the manifest`);
    }
    if (usable.length === 0) {
      this.logger.warn(`project ${project.id}: no usable photo, left out of the manifest`);
      return null;
    }
    const cover = usable.find((photo) => photo.id === project.coverPhotoId) ?? usable[0];
    const og = this.media.source(cover, 'og-branded');
    if (!og || !og.width || !og.height) {
      this.logger.warn(`project ${project.id}: the cover has no OG image, left out of the manifest`);
      return null;
    }

    const described = await this.media.describe(orgId, usable, FILE_RENDITIONS);
    const photos: ManifestPhoto[] = [];
    for (const photo of usable) {
      const renditions: Partial<Record<(typeof FILE_RENDITIONS)[number], { path: string; width: number; height: number; sha256: string }>> = {};
      for (const name of FILE_RENDITIONS) {
        const descriptor = described.get(`${photo.id}/${name}`);
        if (descriptor && descriptor.width > 0 && descriptor.height > 0) renditions[name] = { path: mediaPath(photo.id, name), ...descriptor };
      }
      if (!renditions.master || !renditions.card4x3 || !renditions.hero16x9) {
        this.logger.warn(`project ${project.id}: photo ${photo.id} has an unreadable rendition, left out of the manifest`);
        continue;
      }
      photos.push({
        id: photo.id,
        role: photo.role,
        sortOrder: photo.sortOrder,
        altText: photo.altText,
        caption: photo.caption === '' ? null : photo.caption,
        fileSlug: SLUG_PATTERN.test(photo.fileSlug) ? photo.fileSlug : `photo-${photo.id.slice(0, 8)}`,
        width: renditions.master.width,
        height: renditions.master.height,
        dominantColor: photo.dominantColor ?? null,
        focal: { x: photo.focalX, y: photo.focalY },
        renditions: renditions as ManifestPhoto['renditions'],
      });
    }
    if (photos.length === 0 || !photos.some((photo) => photo.id === cover.id)) {
      this.logger.warn(`project ${project.id}: the cover photo is unusable, left out of the manifest`);
      return null;
    }

    return {
      id: project.id,
      slug: project.slug,
      title: project.title,
      seoTitle: project.seoTitle === '' ? null : project.seoTitle,
      metaDescription: project.metaDescription,
      summary: project.summary,
      bodyMarkdown: project.body,
      serviceSlug: project.serviceSlug,
      townSlug: project.townSlug,
      townName: findTown(project.townSlug)?.name ?? titleCase(project.townSlug),
      completedOn: project.completedOn ? project.completedOn.toISOString().slice(0, 10) : null,
      publishedAt: (project.publishedAt ?? project.updatedAt).toISOString(),
      updatedAt: project.updatedAt.toISOString(),
      featured: project.featured,
      cover: cover.id,
      ogImage: { path: mediaPath(cover.id, 'og-branded'), width: og.width, height: og.height },
      photos,
    };
  }

  private isUsable(photo: PhotoRow): boolean {
    if (photo.processingStatus !== 'ready' || !photo.width || !photo.height) return false;
    const stored = (photo.renditions ?? {}) as Record<string, { objectId?: string } | undefined>;
    return Boolean(stored.card4x3?.objectId && stored.hero16x9?.objectId);
  }

  /**
   * One rendition's bytes, only for a photo of a PUBLISHED project of the
   * organization (any other photo is a 404, never a hint that it exists).
   */
  @Trace('site.media.get')
  async getMedia(orgId: string, photoId: string, rendition: SiteMediaRendition): Promise<MediaFile> {
    setSpanAttributes({ orgId, photoId, rendition });
    const photo = await this.prisma.runInOrg(orgId, (tx) =>
      tx.projectPhoto.findFirst({
        where: { id: photoId, orgId, project: { status: 'published' } },
        select: { id: true, width: true, height: true, chosenVariant: true, originalObjectId: true, enhancedObjectId: true, retouchedObjectId: true, renditions: true },
      }),
    );
    if (!photo) throw new NotFoundException('Media not found');
    const file = await this.media.file(orgId, photo as MediaPhoto, rendition);
    if (!file) throw new NotFoundException('Media not found');
    return file;
  }

  /**
   * Records the site build's report. The state row is written in its own
   * transaction; the events seam and (for `live`) the IndexNow ping request run
   * AFTER it commits and never inside it. A failure of either seam is logged and
   * does not fail the report.
   */
  async recordBuild(orgId: string, report: BuildStatus): Promise<{ contentVersion: string; status: BuildStatus['status'] }> {
    const previous = await this.prisma.runInOrg(orgId, async (tx) => {
      const existing = await tx.sitePublishState.findFirst({ where: { orgId }, select: { lastBuildVersion: true } });
      const data = {
        lastBuildVersion: report.contentVersion,
        lastBuildAt: new Date(),
        lastBuildStatus: report.status,
        lastBuildError: report.status === 'failed' ? (report.error ?? 'The site build failed') : null,
      };
      await tx.sitePublishState.upsert({ where: { orgId }, create: { orgId, ...data }, update: data });
      return existing?.lastBuildVersion ?? null;
    });
    this.logger.log(`site.build-status version=${report.contentVersion} status=${report.status} durationMs=${report.durationMs}`);
    this.metrics?.siteBuild(report.status, report.durationMs);

    const event = { orgId, contentVersion: report.contentVersion, durationMs: report.durationMs, ...(report.error ? { error: report.error } : {}) };
    const guard = async (name: string, fn: () => Promise<void> | void) => {
      try {
        await fn();
      } catch (error) {
        this.logger.error(`site.build-status ${name} failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    };
    if (report.status === 'live') {
      await guard('publishBuildLive', () => this.events.publishBuildLive(event));
      await guard('requestPing', () => this.ping.requestPing({ orgId, fromVersion: previous, toVersion: report.contentVersion }));
    } else {
      await guard('publishBuildFailed', () => this.events.publishBuildFailed(event));
    }
    return { contentVersion: report.contentVersion, status: report.status };
  }

  async status(orgId: string): Promise<SiteStatusView> {
    const state = await this.prisma.runInOrg(orgId, (tx) => tx.sitePublishState.findFirst({ where: { orgId } }));
    return {
      contentVersion: state?.contentVersion ?? '',
      lastBuildVersion: state?.lastBuildVersion ?? null,
      lastBuildAt: state?.lastBuildAt?.toISOString() ?? null,
      lastBuildStatus: state?.lastBuildStatus ?? null,
      lastBuildError: state?.lastBuildError ?? null,
      lastPing: {
        at: state?.lastPingAt?.toISOString() ?? null,
        status: state?.lastPingStatus ?? null,
        error: state?.lastPingError ?? null,
        urlCount: state?.lastPingUrlCount ?? null,
      },
    };
  }
}
