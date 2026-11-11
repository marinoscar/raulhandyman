import { Module } from '@nestjs/common';
import { CredentialsModule } from '@marinoscar/platform-api/credentials';
import { StorageProvidersModule } from '@marinoscar/platform-api/storage';

import { ProjectMediaStore } from '../projects/media/project-media.store';
import { IndexNowKeyService } from './indexnow-key.service';
import { SitePingEnqueuer } from './site-ping.enqueuer';
import { SitePingHandler } from './site-ping.job';
import { SiteMediaService } from './site-media.service';
import { SiteIndexNowController, SiteController } from './site.controller';
import { SiteEventsPublisher, SitePingPort } from './site.ports';
import { SiteService } from './site.service';

/**
 * The published-content API of the static site (issue #28) and the IndexNow
 * ping (issue #30). `SiteEventsPublisher` (notifications and webhooks, issue
 * #39) is the seam later issues fill; its default does nothing. `SitePingPort`
 * is bound to the queue.
 */
@Module({
  imports: [CredentialsModule, StorageProvidersModule],
  controllers: [SiteController, SiteIndexNowController],
  providers: [
    SiteService,
    SiteMediaService,
    ProjectMediaStore,
    IndexNowKeyService,
    SitePingHandler,
    SiteEventsPublisher,
    SitePingEnqueuer,
    { provide: SitePingPort, useExisting: SitePingEnqueuer },
  ],
  exports: [SiteService, SiteEventsPublisher, SitePingPort],
})
export class SiteModule {}
