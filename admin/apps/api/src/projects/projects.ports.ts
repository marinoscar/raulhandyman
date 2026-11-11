import { Injectable } from '@nestjs/common';

/** What happened to a project, for the notification and webhook hook (issue #39 implements it). */
export interface ProjectEvent {
  orgId: string;
  projectId: string;
  slug: string;
  /** The project's title (never `workNotes`), for the `projects.published` payload. */
  title?: string;
  actorUserId: string;
}

/**
 * The seam where `projects.published` and its siblings will be sent through the
 * notifications slice (issue #39). The default does nothing; #39 provides a
 * subclass (`{ provide: ProjectEventsPublisher, useClass: ... }` in the module)
 * that calls `notify()`. The service calls it AFTER the transaction commits and
 * never inside one.
 */
@Injectable()
export class ProjectEventsPublisher {
  publishPublished(_event: ProjectEvent): Promise<void> | void {}
  publishUnpublished(_event: ProjectEvent): Promise<void> | void {}
}

export type PhotoProcessingStage = 'analyze' | 'enhance' | 'crops';

export interface PhotoToProcess {
  orgId: string;
  projectId: string;
  photoId: string;
  userId: string;
}

/**
 * The seam where the `projects.photo.process` job is enqueued (issue #17). The
 * default does nothing, so adding a photo works before the job exists; #17
 * provides the implementation that enqueues through `JobsService`. Called
 * after the photo row commits, never inside a transaction.
 */
@Injectable()
export class PhotoProcessingPort {
  enqueue(_photo: PhotoToProcess, _stages: readonly PhotoProcessingStage[]): Promise<void> | void {}
}

/** What an AI job finished, for the notification hook (issue #39). */
export interface AiReadyEvent {
  orgId: string;
  projectId: string;
  userId: string;
  /** The photo, for a retouch (and a photo-level regenerate). */
  photoId?: string;
  jobId: string;
}

/**
 * The seam where `projects.ai.ready` and `projects.retouch.ready` will be sent
 * through the notifications slice (issue #39). The default does nothing. The AI
 * jobs call it AFTER their write commits, never inside a transaction, and a
 * failure here never fails the job.
 */
@Injectable()
export class AiEventsPublisher {
  publishSuggestReady(_event: AiReadyEvent): Promise<void> | void {}
  publishRetouchReady(_event: AiReadyEvent): Promise<void> | void {}
}

/** A photo's processing finished (or finally failed), for the notification hook (issue #39). */
export interface PhotoReadyEvent {
  orgId: string;
  projectId: string;
  photoId: string;
  /** The photo's uploader (`ProjectPhoto.createdById`); null when the uploader was removed. */
  uploaderId: string | null;
  status: 'ok' | 'failed';
}

/**
 * The seam where `projects.photo.ready` is sent through the notifications
 * slice. The default does nothing. `projects.photo.process` calls it after its
 * last write committed, and a failure here never fails the job.
 */
@Injectable()
export class PhotoEventsPublisher {
  publishPhotoReady(_event: PhotoReadyEvent): Promise<void> | void {}
}
