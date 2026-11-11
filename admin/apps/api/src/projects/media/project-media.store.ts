import { Inject, Injectable, Logger } from '@nestjs/common';
import { Readable } from 'node:stream';
import { buildObjectKey, STORAGE_PROVIDER, StorageProviderRouter, type StorageProvider } from '@marinoscar/platform-api/storage';

import { PrismaService } from '../../prisma/prisma.service';

/** A storage key under `project-media/`: `project-media/<orgId>/<projectId>/<photoId>/<name>`. */
export function projectMediaKey(orgId: string, projectId: string, photoId: string, name: string): string {
  return buildObjectKey('project-media', { orgId }, projectId, photoId, name);
}

export interface StoredFile {
  orgId: string;
  projectId: string;
  photoId: string;
  /** File name under the photo's folder, for example `enhanced.jpg`. */
  name: string;
  buffer: Buffer;
  mimeType: string;
  uploadedById: string | null;
}

/** The most bytes read back into memory (the platform's upload ceiling is 25 MB; renditions are smaller). */
const MAX_READ_BYTES = 64 * 1024 * 1024;

/**
 * Server-side storage I/O for the photo job: read an object's bytes, and write
 * a rendition as a `ready` storage object. A write is an upsert on the storage
 * key, so a retry or a re-run overwrites the same key and the same row: nothing
 * is duplicated.
 */
@Injectable()
export class ProjectMediaStore {
  private readonly logger = new Logger(ProjectMediaStore.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(STORAGE_PROVIDER) private readonly provider: StorageProvider,
    private readonly router: StorageProviderRouter,
  ) {}

  /** The bytes of a storage object of the organization. */
  async read(objectId: string, orgId: string): Promise<Buffer> {
    const row = await this.prisma.runInOrg(orgId, (tx) =>
      tx.storageObject.findFirst({ where: { id: objectId, orgId }, select: { storageKey: true, storageProvider: true, bucket: true } }),
    );
    if (!row) throw new Error(`Storage object ${objectId} not found`);
    const provider = await this.router.forObject(row);
    const stream = await provider.download(row.storageKey);
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of stream) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += buffer.length;
      if (size > MAX_READ_BYTES) {
        stream.destroy();
        throw new Error(`Storage object ${objectId} is larger than ${MAX_READ_BYTES} bytes`);
      }
      chunks.push(buffer);
    }
    return Buffer.concat(chunks);
  }

  /** Writes `file` to its deterministic key and returns the storage object id (the same one on every re-run). */
  async write(file: StoredFile): Promise<string> {
    const storageKey = projectMediaKey(file.orgId, file.projectId, file.photoId, file.name);
    const result = await this.provider.upload(storageKey, Readable.from([file.buffer]), { mimeType: file.mimeType, contentLength: file.buffer.length });
    const data = {
      name: file.name,
      size: BigInt(file.buffer.length),
      mimeType: file.mimeType,
      storageProvider: this.provider.kind,
      bucket: result.bucket,
      status: 'ready' as const,
      metadata: { source: 'projects', projectId: file.projectId, photoId: file.photoId },
    };
    const id = await this.prisma.runInOrg(
      file.orgId,
      async (tx) => {
        const existing = await tx.storageObject.findFirst({ where: { orgId: file.orgId, storageKey }, select: { id: true } });
        if (existing) {
          await tx.storageObject.update({ where: { id: existing.id }, data });
          return existing.id;
        }
        const created = await tx.storageObject.create({ data: { ...data, orgId: file.orgId, storageKey, uploadedById: file.uploadedById }, select: { id: true } });
        return created.id;
      },
      file.uploadedById ? { userId: file.uploadedById } : {},
    );
    this.logger.debug(`wrote ${storageKey} (${file.buffer.length} bytes)`);
    return id;
  }
}
