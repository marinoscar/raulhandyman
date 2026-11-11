// =============================================================================
// The app's binding of the exports slice's host ports
// =============================================================================
//
//   EXPORTS_SYSTEM_DATA  PrismaSystemService: the bypass client. Reasons
//                        `export` (a source's reads across organizations,
//                        always filtered on the owner or the organization; the
//                        status and download routes' storage-object lookups)
//                        and `purge` (the expiry of export files).
//   EXPORTS_NOTIFIER     ExportsNotifierAdapter (NotificationsService).
//
// PLATFORM_PRISMA, AUDIT_SINK, STORAGE_PROVIDER and JobsService come from the
// app's global modules.
// =============================================================================

import { Module } from '@nestjs/common';
import { EXPORTS_NOTIFIER, EXPORTS_SYSTEM_DATA } from '@marinoscar/platform-api/exports';

import { PrismaSystemService } from '../../prisma/prisma-system.service';
import { NotificationsModule } from '../notifications/notifications.config';
import { ExportsNotifierAdapter } from './exports-notifier.adapter';

@Module({
  imports: [NotificationsModule],
  providers: [
    ExportsNotifierAdapter,
    { provide: EXPORTS_SYSTEM_DATA, useExisting: PrismaSystemService },
    { provide: EXPORTS_NOTIFIER, useExisting: ExportsNotifierAdapter },
  ],
  exports: [EXPORTS_SYSTEM_DATA, EXPORTS_NOTIFIER],
})
export class ExportsHostModule {}
