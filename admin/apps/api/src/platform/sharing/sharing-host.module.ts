// =============================================================================
// The app's binding of the sharing slice's host ports
// =============================================================================
//
//   SHARING_DATA           SharingDataAdapter (PrismaService.runInOrg, PrismaSystemService.runAsSystem)
//   SHARING_EVENT_BUS      the process's EVENT_BUS (the global host core)
//   SHARING_EVENT_EMITTER  EventEmitter2 (EventEmitterModule.forRoot in app.module.ts)
//   SHARING_NOTIFIER       SharingNotifierAdapter (NotificationsService)
//   SHARING_TENANCY        TenancyService (the identity slice's OrganizationsModule)
//   SHARING_JOBS           SharingJobsAdapter (JobsService, JobHandlerRegistry)
// =============================================================================

import { Module } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { EVENT_BUS } from '@marinoscar/platform-api/host';
import { OrganizationsModule, TenancyService } from '@marinoscar/platform-api/identity';
import {
  SHARING_DATA,
  SHARING_EVENT_BUS,
  SHARING_EVENT_EMITTER,
  SHARING_JOBS,
  SHARING_NOTIFIER,
  SHARING_TENANCY,
} from '@marinoscar/platform-api/sharing';

import { NotificationsModule } from '../notifications/notifications.config';
import { SharingDataAdapter } from './sharing-data.adapter';
import { SharingJobsAdapter } from './sharing-jobs.adapter';
import { SharingNotifierAdapter } from './sharing-notifier.adapter';

@Module({
  // The queue is global (JobsModule.forRoot), so it is not imported here.
  imports: [NotificationsModule, OrganizationsModule],
  providers: [
    SharingDataAdapter,
    SharingNotifierAdapter,
    SharingJobsAdapter,
    { provide: SHARING_DATA, useExisting: SharingDataAdapter },
    { provide: SHARING_EVENT_BUS, useExisting: EVENT_BUS },
    { provide: SHARING_EVENT_EMITTER, useExisting: EventEmitter2 },
    { provide: SHARING_NOTIFIER, useExisting: SharingNotifierAdapter },
    { provide: SHARING_TENANCY, useExisting: TenancyService },
    { provide: SHARING_JOBS, useExisting: SharingJobsAdapter },
  ],
  exports: [SHARING_DATA, SHARING_EVENT_BUS, SHARING_EVENT_EMITTER, SHARING_NOTIFIER, SHARING_TENANCY, SHARING_JOBS],
})
export class SharingHostModule {}
