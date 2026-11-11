import { Module } from '@nestjs/common';
import { CredentialsModule } from '@marinoscar/platform-api/credentials';
import { StorageProvidersModule } from '@marinoscar/platform-api/storage';

import { ProjectsEventsModule } from '../projects/events/projects-events.module';
import { ProjectMediaStore } from '../projects/media/project-media.store';
import { IndexNowKeyService } from './indexnow-key.service';
import { SitePingEnqueuer } from './site-ping.enqueuer';
import { SitePingHandler } from './site-ping.job';
import { SiteMediaService } from './site-media.service';
import { SiteIndexNowController, SiteController } from './site.controller';
import { SitePingPort } from './site.ports';
import { SiteService } from './site.service';

/**
 * The published-content API of the static site (issue #28) and the IndexNow
 * ping (issue #30). `SiteEventsPublisher` is bound to the notifications
 * slice by `ProjectsEventsModule` (issue #39). `SitePingPort`
 * is bound to the queue.
 */
@Module({
  imports: [CredentialsModule, StorageProvidersModule, ProjectsEventsModule],
  controllers: [SiteController, SiteIndexNowController],
  providers: [
    SiteService,
    SiteMediaService,
    ProjectMediaStore,
    IndexNowKeyService,
    SitePingHandler,
    SitePingEnqueuer,
    { provide: SitePingPort, useExisting: SitePingEnqueuer },
  ],
  exports: [SiteService, SitePingPort],
})
export class SiteModule {}
