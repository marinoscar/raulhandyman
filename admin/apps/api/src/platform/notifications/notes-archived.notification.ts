// =============================================================================
// The minimal example of an app notification: `notes.archived`
// =============================================================================
//
// One event, one email template (`email/templates/notes-archived.email.ts`) and
// one browser renderer. Declared here as data and registered by
// `./notification.manifest.ts`; raised by the sample feature's archive job
// (`src/notes/notes-archive.job.ts`) AFTER its write committed:
//
//   this.notifications.notify('notes.archived', userId, { count, notesUrl });
//
// An event key is persisted (preferences, delivery rows): never rename it.
// =============================================================================

import type { BrowserNotificationTemplate, NotificationRegistration } from '@marinoscar/platform-api/notifications';

/** The event key. Permanent. */
export const NOTES_ARCHIVED_EVENT = 'notes.archived';

const browserTemplate: BrowserNotificationTemplate = (data) => {
  const count = typeof (data as { count?: unknown }).count === 'number' ? (data as { count: number }).count : 0;
  return {
    title: 'Notes archived',
    body: `${count} of your ${count === 1 ? 'note was' : 'notes were'} archived.`,
    link: '/notes',
  };
};

export const NOTES_NOTIFICATIONS: readonly NotificationRegistration[] = [
  {
    event: {
      key: NOTES_ARCHIVED_EVENT,
      label: 'Notes archived',
      description: 'Sent when untouched notes of yours are archived automatically.',
      channels: ['email', 'browser'],
      defaultEnabled: false,
    },
    emailTemplate: 'notes-archived',
    browserTemplate,
  },
];
