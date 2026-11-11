import { Module } from '@nestjs/common';

import { SiteEventsPublisher } from '../../site/site.ports';
import { AiEventsPublisher, PhotoEventsPublisher, ProjectEventsPublisher } from '../projects.ports';
import { NotifyingAiEventsPublisher, NotifyingPhotoEventsPublisher, NotifyingProjectEventsPublisher, NotifyingSiteEventsPublisher } from './project-event-publishers';
import { ProjectNotifier } from './project-notifier';
import { ProjectsMetrics } from './projects.metrics';

/**
 * The notification publishers (issue #39) bound to the four event seams, and
 * the projects and site metrics recorder (issue #40). Imported by every module
 * that raises an event or records a metric; it imports nothing of theirs, so
 * it adds no cycle. The prisma, host (metrics) and notifications modules are
 * global.
 */
@Module({
  providers: [
    ProjectNotifier,
    ProjectsMetrics,
    { provide: ProjectEventsPublisher, useClass: NotifyingProjectEventsPublisher },
    { provide: AiEventsPublisher, useClass: NotifyingAiEventsPublisher },
    { provide: PhotoEventsPublisher, useClass: NotifyingPhotoEventsPublisher },
    { provide: SiteEventsPublisher, useClass: NotifyingSiteEventsPublisher },
  ],
  exports: [ProjectNotifier, ProjectsMetrics, ProjectEventsPublisher, AiEventsPublisher, PhotoEventsPublisher, SiteEventsPublisher],
})
export class ProjectsEventsModule {}
