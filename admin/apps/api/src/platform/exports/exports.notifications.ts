// =============================================================================
// The exports slice's notifications, registered with the app's registries
// =============================================================================
//
// `export.ready` and `export.failed`, on the `browser` and `push` channels, on
// by default, not mandatory. The events and their renderers are the slice's
// (`@marinoscar/platform-api/exports`); the slice sends them through the
// EXPORTS_NOTIFIER port after the job's write committed. Registered by
// `./exports.slice.ts`. Pure data, no side effect.
// =============================================================================

import {
  EXPORT_FAILED_EVENT,
  EXPORT_READY_EVENT,
  exportFailedBrowserTemplate,
  exportReadyBrowserTemplate,
} from '@marinoscar/platform-api/exports';

import type { BrowserNotificationTemplate, NotificationRegistration } from '@marinoscar/platform-api/notifications';

export const EXPORTS_NOTIFICATIONS: readonly NotificationRegistration[] = [EXPORT_READY_EVENT, EXPORT_FAILED_EVENT].map(
  (event, index): NotificationRegistration => ({
    event: {
      key: event.key,
      label: event.label,
      description: event.description,
      channels: [...event.channels],
      defaultEnabled: event.defaultEnabled,
    },
    browserTemplate: (index === 0 ? exportReadyBrowserTemplate : exportFailedBrowserTemplate) as BrowserNotificationTemplate,
  }),
);
