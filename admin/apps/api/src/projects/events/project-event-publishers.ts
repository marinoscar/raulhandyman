// The notification-sending subclasses of the four seams (issue #39). Each is
// called AFTER the triggering write committed and outside any transaction; the
// callers contain a failure here, and `ProjectNotifier` never throws anyway.
import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../prisma/prisma.service';
import { AiEventsPublisher, PhotoEventsPublisher, ProjectEventsPublisher, type AiReadyEvent, type PhotoReadyEvent, type ProjectEvent } from '../projects.ports';
import { SiteEventsPublisher, type SiteBuildEvent } from '../../site/site.ports';
import {
  errorExcerpt,
  PROJECT_NOTIFICATION_EVENTS as EVENTS,
  type AiReadyData,
  type BuildFailedData,
  type BuildLiveData,
  type PhotoReadyData,
  type PublishedData,
  type RetouchReadyData,
} from '../projects.notifications';
import { PROJECTS_PERMISSIONS } from '../projects.permissions';
import { ProjectNotifier } from './project-notifier';

/** `projects.published` to every `projects:publish` holder except the actor. `unpublish` notifies nobody. */
@Injectable()
export class NotifyingProjectEventsPublisher extends ProjectEventsPublisher {
  constructor(private readonly notifier: ProjectNotifier) {
    super();
  }

  override async publishPublished(event: ProjectEvent): Promise<void> {
    const holders = await this.notifier.holdersOf(event.orgId, PROJECTS_PERMISSIONS.PROJECTS_PUBLISH.id);
    const data: PublishedData = { projectId: event.projectId, title: event.title ?? '', url: this.notifier.appLink(`/projects/${event.projectId}`) };
    await this.notifier.send(EVENTS.PUBLISHED, event.orgId, holders.filter((id) => id !== event.actorUserId), data as unknown as Record<string, unknown>);
  }
}

/** `projects.ai.ready` and `projects.retouch.ready` to the requesting user. */
@Injectable()
export class NotifyingAiEventsPublisher extends AiEventsPublisher {
  constructor(private readonly notifier: ProjectNotifier) {
    super();
  }

  override async publishSuggestReady(event: AiReadyEvent): Promise<void> {
    const data: AiReadyData = { projectId: event.projectId, status: 'ok' };
    await this.notifier.send(EVENTS.AI_READY, event.orgId, [event.userId], data as unknown as Record<string, unknown>);
  }

  override async publishRetouchReady(event: AiReadyEvent): Promise<void> {
    const data: RetouchReadyData = { projectId: event.projectId, photoId: event.photoId ?? '' };
    await this.notifier.send(EVENTS.RETOUCH_READY, event.orgId, [event.userId], data as unknown as Record<string, unknown>);
  }
}

/** `projects.photo.ready` to the photo's uploader. */
@Injectable()
export class NotifyingPhotoEventsPublisher extends PhotoEventsPublisher {
  constructor(private readonly notifier: ProjectNotifier) {
    super();
  }

  override async publishPhotoReady(event: PhotoReadyEvent): Promise<void> {
    const data: PhotoReadyData = { projectId: event.projectId, photoId: event.photoId, status: event.status };
    await this.notifier.send(EVENTS.PHOTO_READY, event.orgId, [event.uploaderId], data as unknown as Record<string, unknown>);
  }
}

/** `site.build.live` to the publisher of the newest change; `site.build.failed` to the administrators. */
@Injectable()
export class NotifyingSiteEventsPublisher extends SiteEventsPublisher {
  constructor(
    private readonly notifier: ProjectNotifier,
    private readonly prisma: PrismaService,
  ) {
    super();
  }

  override async publishBuildLive(event: SiteBuildEvent): Promise<void> {
    const newest = await this.prisma.runInOrg(event.orgId, (tx) =>
      tx.project.findFirst({ where: { status: 'published' }, orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }], select: { updatedById: true } }),
    );
    const recipients = newest?.updatedById ? [newest.updatedById] : await this.notifier.adminsOf(event.orgId);
    // The public site's own URL is not known to the admin; the link opens the Site publishing page.
    const data: BuildLiveData = { contentVersion: event.contentVersion, url: this.notifier.appLink('/admin/settings/site-publishing') };
    await this.notifier.send(EVENTS.BUILD_LIVE, event.orgId, recipients, data as unknown as Record<string, unknown>);
  }

  override async publishBuildFailed(event: SiteBuildEvent): Promise<void> {
    const admins = await this.notifier.adminsOf(event.orgId);
    const data: BuildFailedData = {
      contentVersion: event.contentVersion,
      error: errorExcerpt(event.error),
      statusUrl: this.notifier.appLink('/admin/settings/site-publishing'),
    };
    await this.notifier.send(EVENTS.BUILD_FAILED, event.orgId, admins, data as unknown as Record<string, unknown>);
  }
}
