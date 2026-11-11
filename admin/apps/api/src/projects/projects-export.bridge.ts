import { Injectable, type OnModuleInit } from '@nestjs/common';

import { ProjectMediaStore } from './media/project-media.store';

/** Reads one storage object of an organization (the projects export writer's only storage access). */
export type ExportMediaReader = (objectId: string, orgId: string) => Promise<Buffer>;

let reader: ExportMediaReader | null = null;

/** The reader the `projects-zip` export writer uses; throws while the projects module is not running. */
export function getExportMediaReader(): ExportMediaReader {
  if (!reader) throw new Error('The projects export cannot read photos: the media store is not available.');
  return reader;
}

/** Test seam: replaces (or clears) the reader. */
export function setExportMediaReader(next: ExportMediaReader | null): void {
  reader = next;
}

/**
 * Hands `ProjectMediaStore` to the export writer. A writer is a plain object
 * registered before Nest builds the graph, so it cannot inject a service; this
 * provider closes the gap at startup. Read only: the writer never writes.
 */
@Injectable()
export class ProjectsExportBridge implements OnModuleInit {
  constructor(private readonly store: ProjectMediaStore) {}

  onModuleInit(): void {
    setExportMediaReader((objectId, orgId) => this.store.read(objectId, orgId));
  }
}
