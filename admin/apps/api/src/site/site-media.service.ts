import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import sharp from 'sharp';

import { PrismaService } from '../prisma/prisma.service';
import { ProjectMediaStore } from '../projects/media/project-media.store';
import { chosenObjectId } from '../projects/site-content-version';
import type { SiteMediaRendition } from './site-manifest.schema';

/** The photo columns the site media needs. */
export interface MediaPhoto {
  id: string;
  width: number | null;
  height: number | null;
  chosenVariant: string;
  originalObjectId: string;
  enhancedObjectId: string | null;
  retouchedObjectId: string | null;
  renditions: unknown;
}

export interface MediaDescriptor {
  width: number;
  height: number;
  sha256: string;
}

export interface MediaFile extends MediaDescriptor {
  buffer: Buffer;
  contentType: 'image/jpeg';
}

type StoredRendition = { objectId?: string; w?: number; h?: number };
type Source = { objectId: string; width: number | null; height: number | null; normalise: boolean };

const FILE_EXTENSION = 'jpg';
/** Descriptors kept in memory (sha256 and size only, never bytes). */
const CACHE_LIMIT = 5000;

/** The manifest path of a rendition, relative to `/api/site/`. */
export const mediaPath = (photoId: string, rendition: SiteMediaRendition): string => `media/${photoId}/${rendition}.${FILE_EXTENSION}`;

/**
 * Resolves a manifest rendition to storage objects, and computes the sha256 the
 * manifest requires. The photo job stores object ids and sizes but no hash, and
 * the `master` is the photo's CHOSEN variant, so both are derived here at read
 * time. A descriptor is cached by `(object id, storage object updatedAt)`: the
 * media store overwrites an object in place, which bumps `updatedAt`, so a
 * regenerated file is re-hashed and an unchanged one never is.
 *
 * `master` is the chosen variant with metadata stripped: the enhanced file is
 * already stripped (the photo job re-encodes it), so it is served as stored;
 * any other file (the original, or an AI-retouched file of unknown format) is
 * re-encoded to JPEG with its orientation applied and its metadata dropped.
 */
@Injectable()
export class SiteMediaService {
  private readonly logger = new Logger(SiteMediaService.name);
  private readonly cache = new Map<string, MediaDescriptor>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly store: ProjectMediaStore,
  ) {}

  /** Where a rendition's bytes live, or null when the photo has no such rendition (yet). */
  source(photo: MediaPhoto, rendition: SiteMediaRendition): Source | null {
    const stored = (photo.renditions ?? {}) as Record<string, StoredRendition | undefined>;
    if (rendition === 'master') {
      const objectId = chosenObjectId(photo);
      const enhanced = objectId === photo.enhancedObjectId;
      return { objectId, width: photo.width, height: photo.height, normalise: !enhanced };
    }
    const key = rendition === 'og-branded' ? (stored.ogBranded?.objectId ? 'ogBranded' : 'og') : rendition;
    const entry = stored[key];
    if (!entry?.objectId) return null;
    return { objectId: entry.objectId, width: entry.w ?? null, height: entry.h ?? null, normalise: false };
  }

  /** The objects' `updatedAt` stamps, one query. A missing object is absent from the map. */
  private async stamps(orgId: string, objectIds: string[]): Promise<Map<string, number>> {
    const rows = await this.prisma.runInOrg(orgId, (tx) =>
      tx.storageObject.findMany({ where: { id: { in: objectIds }, orgId, status: 'ready' }, select: { id: true, updatedAt: true } }),
    );
    return new Map(rows.map((row) => [row.id, row.updatedAt.getTime()]));
  }

  private async load(orgId: string, source: Source): Promise<MediaFile> {
    let buffer = await this.store.read(source.objectId, orgId);
    let width = source.width;
    let height = source.height;
    if (source.normalise) {
      const out = await sharp(buffer).rotate().jpeg({ quality: 92 }).toBuffer({ resolveWithObject: true });
      buffer = out.data;
      width = out.info.width;
      height = out.info.height;
    }
    if (!width || !height) {
      const meta = await sharp(buffer).metadata();
      width = meta.width ?? 0;
      height = meta.height ?? 0;
    }
    return { buffer, contentType: 'image/jpeg', width, height, sha256: createHash('sha256').update(buffer).digest('hex') };
  }

  /** The bytes of a rendition with their hash; null when the photo has none or the object is gone. */
  async file(orgId: string, photo: MediaPhoto, rendition: SiteMediaRendition): Promise<MediaFile | null> {
    const source = this.source(photo, rendition);
    if (!source) return null;
    try {
      const file = await this.load(orgId, source);
      this.remember(orgId, source, file, (await this.stamps(orgId, [source.objectId])).get(source.objectId));
      return file;
    } catch (error) {
      this.logger.warn(`site media ${photo.id}/${rendition}: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
  }

  private remember(orgId: string, source: Source, file: MediaDescriptor, stamp: number | undefined): void {
    if (stamp === undefined) return;
    if (this.cache.size >= CACHE_LIMIT) this.cache.clear();
    this.cache.set(this.cacheKey(orgId, source, stamp), { width: file.width, height: file.height, sha256: file.sha256 });
  }

  private cacheKey = (orgId: string, source: Source, stamp: number): string => `${orgId}:${source.objectId}:${stamp}:${source.normalise ? 'n' : 'r'}`;

  /** Descriptors (size and sha256) of the photo's renditions, from the cache or computed; null for one that cannot be read. */
  async describe(orgId: string, photos: readonly MediaPhoto[], renditions: readonly SiteMediaRendition[]): Promise<Map<string, MediaDescriptor | null>> {
    const wanted: Array<{ key: string; photo: MediaPhoto; rendition: SiteMediaRendition; source: Source }> = [];
    for (const photo of photos) {
      for (const rendition of renditions) {
        const source = this.source(photo, rendition);
        if (source) wanted.push({ key: `${photo.id}/${rendition}`, photo, rendition, source });
      }
    }
    const stamps = await this.stamps(orgId, [...new Set(wanted.map((item) => item.source.objectId))]);
    const out = new Map<string, MediaDescriptor | null>();
    for (const photo of photos) for (const rendition of renditions) out.set(`${photo.id}/${rendition}`, null);

    const misses: typeof wanted = [];
    for (const item of wanted) {
      const stamp = stamps.get(item.source.objectId);
      if (stamp === undefined) continue; // the object is not ready or gone
      const hit = this.cache.get(this.cacheKey(orgId, item.source, stamp));
      if (hit) out.set(item.key, hit);
      else misses.push(item);
    }
    // Cold entries are read a few at a time: a first manifest after a deploy hashes every file once.
    const CONCURRENCY = 4;
    let next = 0;
    const worker = async () => {
      while (next < misses.length) {
        const item = misses[next++];
        try {
          const file = await this.load(orgId, item.source);
          const descriptor = { width: file.width, height: file.height, sha256: file.sha256 };
          this.remember(orgId, item.source, descriptor, stamps.get(item.source.objectId));
          out.set(item.key, descriptor);
        } catch (error) {
          this.logger.warn(`site media ${item.key}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, misses.length) }, worker));
    return out;
  }
}
