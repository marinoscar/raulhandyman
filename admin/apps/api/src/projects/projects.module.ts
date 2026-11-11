import { Module } from '@nestjs/common';

import { MediaPhotoProcessingPort } from './media/media-photo-processing.port';
import { ProjectMediaModule } from './media/project-media.module';
import { isSliceEnabled } from '../platform/slices/manifest';
import { PhotosService } from './photos.service';
import { ProjectStorageGateway } from './project-storage.gateway';
import { ProjectsController } from './projects.controller';
import { PhotoProcessingPort, ProjectEventsPublisher } from './projects.ports';
import { ProjectsService } from './projects.service';
import { SitePublishService } from './site-publish.service';

// Photos live in the storage slice. Its configured module is built only for an
// enabled slice (`platform/storage/storage.config.ts`), so it is required lazily;
// without it `ProjectStorageGateway` reports every object as unavailable.
const storageImports = isSliceEnabled('storage')
  ? // eslint-disable-next-line @typescript-eslint/no-require-imports
    [(require('../platform/storage/storage.config') as typeof import('../platform/storage/storage.config')).StorageModule]
  : [];

/**
 * The handyman site's content: projects and their photos, the SEO lint and the
 * publish workflow. `ProjectEventsPublisher` (notifications, issue #39) and
 * `PhotoProcessingPort` (the photo job, issue #17) are the two seams later
 * issues fill; their defaults do nothing.
 */
@Module({
  imports: [...storageImports, ProjectMediaModule],
  controllers: [ProjectsController],
  providers: [ProjectsService, PhotosService, SitePublishService, ProjectStorageGateway, ProjectEventsPublisher, { provide: PhotoProcessingPort, useExisting: MediaPhotoProcessingPort }],
  exports: [ProjectsService, SitePublishService, ProjectEventsPublisher, PhotoProcessingPort],
})
export class ProjectsModule {}
