// =============================================================================
// EXPORTS_NOTIFIER adapter: export notifications through the app's
// notifications
// =============================================================================
//
// A pass-through to `NotificationsService.notify`, which resolves the event
// in the registry, applies the user's preferences and fans out to the event's
// channels. Called by the slice after the job's write committed, outside any
// transaction.
// =============================================================================

import { Injectable } from '@nestjs/common';
import type { ExportNotificationData, ExportsNotifier } from '@marinoscar/platform-api/exports';

import { NotificationsService } from '@marinoscar/platform-api/notifications';

@Injectable()
export class ExportsNotifierAdapter implements ExportsNotifier {
  constructor(private readonly notifications: NotificationsService) {}

  notify(eventKey: string, userId: string, data: ExportNotificationData): Promise<void> {
    return this.notifications.notify(eventKey, userId, data);
  }
}
