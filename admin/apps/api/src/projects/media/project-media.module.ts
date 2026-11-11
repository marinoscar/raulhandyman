import { Module } from '@nestjs/common';
import { ObjectProcessingModule, StorageProvidersModule } from '@marinoscar/platform-api/storage';

import { MediaPhotoProcessingPort } from './media-photo-processing.port';
import { ImageValidationProcessor } from './image-validation.processor';
import { PhotoProcessHandler } from './photo-process.job';
import { PhotoProcessingService } from './photo-processing.service';
import { ProjectMediaStore } from './project-media.store';

/**
 * Project photo media: the image-validation object processor, the
 * `projects.photo.process` job and the service that enqueues it. The jobs,
 * settings and prisma modules are global; the storage provider and the object
 * processing registry are imported. Exports `PhotoProcessingService`, which
 * the projects module binds to its photo-processing port.
 */
@Module({
  imports: [StorageProvidersModule, ObjectProcessingModule],
  providers: [ProjectMediaStore, ImageValidationProcessor, PhotoProcessHandler, PhotoProcessingService, MediaPhotoProcessingPort],
  exports: [PhotoProcessingService, MediaPhotoProcessingPort],
})
export class ProjectMediaModule {}
