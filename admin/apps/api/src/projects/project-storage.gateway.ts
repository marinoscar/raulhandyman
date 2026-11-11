import { Injectable, Logger, Optional } from '@nestjs/common';
import { ObjectsService } from '@marinoscar/platform-api/storage';

/** What the photo routes need to know about a storage object. */
export interface StoredObjectInfo {
  id: string;
  name: string;
  status: string;
  mimeType: string;
}

/**
 * The projects module's only door to the storage slice. `ObjectsService`
 * answers 404 for an object of another organization and 403 for one another
 * user uploaded, so "must belong to the caller" is enforced by the slice; this
 * gateway turns both into `null`.
 */
@Injectable()
export class ProjectStorageGateway {
  private readonly logger = new Logger(ProjectStorageGateway.name);

  /** `objects` is absent while the storage slice is off: nothing is then ready, previewable or deletable. */
  constructor(@Optional() private readonly objects?: ObjectsService) {}

  /** The caller's own object, or `null` when it does not exist or is not theirs. */
  async describe(objectId: string, userId: string, orgId: string): Promise<StoredObjectInfo | null> {
    if (!this.objects) return null;
    try {
      const object = await this.objects.getById(objectId, userId, orgId);
      return { id: object.id, name: object.name, status: object.status, mimeType: object.mimeType };
    } catch {
      return null;
    }
  }

  /** A signed URL for a preview, or `null` when none can be made (not ready, not the caller's). */
  async previewUrl(objectId: string, userId: string, orgId: string): Promise<string | null> {
    if (!this.objects) return null;
    try {
      return (await this.objects.getDownloadUrl(objectId, userId, orgId)).url;
    } catch {
      return null;
    }
  }

  /** Best-effort deletion: an object another editor uploaded stays (the slice refuses), and is logged. */
  async deleteAll(objectIds: readonly string[], userId: string, orgId: string): Promise<void> {
    if (!this.objects) return;
    for (const id of new Set(objectIds)) {
      try {
        await this.objects.delete(id, userId, orgId);
      } catch (error) {
        this.logger.warn(`Storage object ${id} was not deleted: ${error instanceof Error ? error.message : 'unknown error'}`);
      }
    }
  }
}
