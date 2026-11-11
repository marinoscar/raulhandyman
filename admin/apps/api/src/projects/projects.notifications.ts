// =============================================================================
// Project and site notifications (issue #39)
// =============================================================================
//
// Six events (the platform's key pattern is `<area>.<name>`, two snake_case
// segments, so the issue's dotted names are spelled `projects.photo_ready`,
// `projects.ai_ready`, `projects.retouch_ready`, `site.build_live` and
// `site.build_failed`), declared as data and registered by
// `src/platform/notifications/notification.manifest.ts`. Raised AFTER the
// triggering write committed, outside any transaction, by the publishers in
// `./events/` (the seams `ProjectEventsPublisher`, `AiEventsPublisher`,
// `PhotoEventsPublisher` and `SiteEventsPublisher`). A key is persisted
// (preferences, delivery rows): never rename one.
//
// Payloads carry ids, a title, a URL or a short build-error excerpt. Never
// `workNotes`, AI output, tokens or storage keys: the builders below pick every
// field by name. The browser template serves the in-app inbox and Web Push;
// `site.build.failed` also has the `site-build-failed` email template.
//
// Channels: an event lists the channels it can use and has one `defaultEnabled`
// switch for all of them (users tune each channel on the notification
// preferences page). "Push off by default" for `projects.photo.ready` is
// therefore expressed by not offering `push` for it at all.
// =============================================================================

import type { BrowserNotificationTemplate, NotificationRegistration } from '@marinoscar/platform-api/notifications';

export const PROJECT_NOTIFICATION_EVENTS = {
  PHOTO_READY: 'projects.photo_ready',
  AI_READY: 'projects.ai_ready',
  RETOUCH_READY: 'projects.retouch_ready',
  PUBLISHED: 'projects.published',
  BUILD_LIVE: 'site.build_live',
  BUILD_FAILED: 'site.build_failed',
} as const;

/** The email template of `site.build.failed`. */
export const SITE_BUILD_FAILED_EMAIL_TEMPLATE = 'site-build-failed';

export interface PhotoReadyData {
  projectId: string;
  photoId: string;
  status: 'ok' | 'failed';
}
export interface AiReadyData {
  projectId: string;
  status: 'ok' | 'failed';
}
export interface RetouchReadyData {
  projectId: string;
  photoId: string;
}
export interface PublishedData {
  projectId: string;
  title: string;
  url: string;
}
export interface BuildLiveData {
  contentVersion: string;
  url: string;
}
export interface BuildFailedData {
  contentVersion: string;
  error: string;
  statusUrl: string;
}

const MAX_ERROR_LENGTH = 200;

/** A short, single-line excerpt of a build error with token-looking strings removed. */
export function errorExcerpt(error: string | undefined): string {
  const flat = (error ?? 'The site build failed').replace(/\s+/g, ' ').trim();
  const clean = flat.replace(/Bearer\s+\S+/gi, 'Bearer [redacted]').replace(/\b[A-Za-z0-9_-]{32,}\b/g, '[redacted]');
  return clean.length > MAX_ERROR_LENGTH ? `${clean.slice(0, MAX_ERROR_LENGTH - 1)}…` : clean;
}

const str = (data: unknown, key: string): string => {
  const value = typeof data === 'object' && data !== null ? (data as Record<string, unknown>)[key] : undefined;
  return typeof value === 'string' ? value : '';
};
const projectLink = (data: unknown): string => (str(data, 'projectId') ? `/projects/${str(data, 'projectId')}` : '/projects');
const failed = (data: unknown): boolean => str(data, 'status') === 'failed';

const photoReady: BrowserNotificationTemplate = (data) => ({
  title: failed(data) ? 'A photo could not be processed' : 'Your photo is ready',
  body: failed(data) ? 'Processing failed. Open the project to try again or upload it again.' : 'The photo was processed and is ready to use.',
  link: projectLink(data),
});
const aiReady: BrowserNotificationTemplate = (data) => ({
  title: failed(data) ? 'The AI draft failed' : 'Your AI draft is ready',
  body: failed(data) ? 'The suggestion could not be made. Open the project to try again.' : 'Review the suggested title, description and photo text.',
  link: projectLink(data),
});
const retouchReady: BrowserNotificationTemplate = (data) => ({
  title: 'Your retouched photo is ready',
  body: 'Compare it with the original and pick the one to use.',
  link: projectLink(data),
});
const published: BrowserNotificationTemplate = (data) => ({
  title: 'A project was published',
  body: str(data, 'title') ? `"${str(data, 'title')}" was published.` : 'A project was published.',
  link: projectLink(data),
});
const buildLive: BrowserNotificationTemplate = (data) => ({
  title: 'The website is updated',
  body: 'The latest changes are live.',
  link: str(data, 'url') || '/admin/settings/site-publishing',
});
const buildFailed: BrowserNotificationTemplate = (data) => ({
  title: 'The website build failed',
  body: str(data, 'error') || 'The site build failed. Open Site publishing for details.',
  link: str(data, 'statusUrl') || '/admin/settings/site-publishing',
});

export const PROJECT_NOTIFICATIONS: readonly NotificationRegistration[] = [
  {
    event: {
      key: PROJECT_NOTIFICATION_EVENTS.PHOTO_READY,
      label: 'Photo processed',
      description: 'Sent to the person who uploaded a project photo when its processing finishes or fails.',
      channels: ['browser'],
      defaultEnabled: true,
    },
    browserTemplate: photoReady,
  },
  {
    event: {
      key: PROJECT_NOTIFICATION_EVENTS.AI_READY,
      label: 'AI draft ready',
      description: 'Sent to the person who asked for an AI draft of a project when it is ready.',
      channels: ['browser', 'push'],
      defaultEnabled: true,
    },
    browserTemplate: aiReady,
  },
  {
    event: {
      key: PROJECT_NOTIFICATION_EVENTS.RETOUCH_READY,
      label: 'Retouched photo ready',
      description: 'Sent to the person who asked for an AI retouch when the retouched photo is ready to compare.',
      channels: ['browser', 'push'],
      defaultEnabled: true,
    },
    browserTemplate: retouchReady,
  },
  {
    event: {
      key: PROJECT_NOTIFICATION_EVENTS.PUBLISHED,
      label: 'Project published',
      description: 'Sent to everyone who can publish projects when someone else publishes one.',
      channels: ['browser'],
      defaultEnabled: true,
    },
    browserTemplate: published,
  },
  {
    event: {
      key: PROJECT_NOTIFICATION_EVENTS.BUILD_LIVE,
      label: 'Website updated',
      description: 'Sent to the person who published the newest change when the website build is live.',
      channels: ['browser', 'push'],
      defaultEnabled: true,
    },
    browserTemplate: buildLive,
  },
  {
    event: {
      key: PROJECT_NOTIFICATION_EVENTS.BUILD_FAILED,
      label: 'Website build failed',
      description: 'Sent to the organization administrators when the website build fails, so the public site is not updated.',
      channels: ['email', 'browser', 'push'],
      defaultEnabled: true,
    },
    emailTemplate: SITE_BUILD_FAILED_EMAIL_TEMPLATE,
    browserTemplate: buildFailed,
  },
];
