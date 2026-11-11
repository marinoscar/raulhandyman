import { Injectable } from '@nestjs/common';

import { PhotoProcessingPort, type PhotoProcessingStage, type PhotoToProcess } from '../projects.ports';
import type { PhotoStage } from './photo-process.job';
import { PhotoProcessingService } from './photo-processing.service';

/**
 * Binds the projects module's `PhotoProcessingPort` (called after a photo row commits) to the
 * queue: it enqueues `projects.photo.process`. The port's `analyze` stage is the job's
 * `enhance` stage (analysis, enhance and crops run together there).
 */
@Injectable()
export class MediaPhotoProcessingPort extends PhotoProcessingPort {
  constructor(private readonly processing: PhotoProcessingService) {
    super();
  }

  override async enqueue(photo: PhotoToProcess, stages: readonly PhotoProcessingStage[]): Promise<void> {
    const mapped = [...new Set(stages.map((s): PhotoStage => (s === 'analyze' ? 'enhance' : s)))];
    await this.processing.enqueue({ id: photo.photoId, projectId: photo.projectId, orgId: photo.orgId }, mapped);
  }
}
