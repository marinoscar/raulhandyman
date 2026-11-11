import { useEffect, useRef } from 'react';
import { useNotifications } from '@marinoscar/platform-web/notifications/headless';
import type { AppNotification } from '@marinoscar/platform-web/notifications/headless';

/**
 * Server events (issue #39). The notification centre keeps the signed-in user's inbox live over
 * the platform SSE stream; an event of this app arrives there as a new inbox row. The editor and
 * the publish bar watch those rows and refetch what they show, so the pages do not poll while the
 * stream is open. Polling stays as the fallback: every 3 seconds while the stream is unavailable
 * (closed, reconnecting, or no notifications slice mounted), and a slow safety net while it is open
 * (a frame can be missed: the stream replays nothing).
 *
 * Event keys are persisted by the API (`projects.notifications.ts`); the payload is not on the
 * wire, but the row's `link` is `/projects/<id>` for project events.
 */
export const PROJECT_EVENT_KEYS: readonly string[] = ['projects.photo_ready', 'projects.ai_ready', 'projects.retouch_ready', 'projects.published'];
export const SITE_EVENT_KEYS: readonly string[] = ['site.build_live', 'site.build_failed'];

export const POLL_INTERVAL_MS = 3000;
/** While the event stream is open: how often a still-pending wait is re-read anyway. */
export const SAFETY_POLL_INTERVAL_MS = 30_000;
export const POLL_MAX_MS = 120_000;

export interface LiveUpdatesOptions {
  /** True while something is processing (a photo, an AI job, a retouch, a site build). */
  active: boolean;
  /** Re-reads what is being waited for. */
  refetch: () => void | Promise<void>;
  /** Called once when the waiting window ends with the work still pending. */
  onTimeout?: () => void;
}

/**
 * Does this inbox row mean "re-read the page"? A project scope wants the project events of that
 * project (matched by the row's `/projects/<id>` link); the site-wide scope (`null`, the publish
 * bar's live status) wants the site build events.
 */
export function isRelevantEvent(notification: Pick<AppNotification, 'eventKey' | 'link'>, scopeId: string | null): boolean {
  if (scopeId === null) return SITE_EVENT_KEYS.includes(notification.eventKey);
  return PROJECT_EVENT_KEYS.includes(notification.eventKey) && (notification.link ?? '').replace(/[?#].*$/, '').endsWith(`/projects/${scopeId}`);
}

const versionOf = (n: AppNotification): string => `${n.id}:${n.updatedAt ?? n.createdAt}:${n.count ?? ''}`;

/**
 * Keeps a page fresh while work runs in the background: refetches when a matching server event
 * arrives, and polls as the fallback (see above) for at most 2 minutes after `active` turns on.
 * `scopeId` (a project id, or null for site-wide) selects the events and restarts the window when
 * the page moves to another project.
 */
export function useProjectLiveUpdates(scopeId: string | null, { active, refetch, onTimeout }: LiveUpdatesOptions): void {
  const refetchRef = useRef(refetch);
  const timeoutRef = useRef(onTimeout);
  refetchRef.current = refetch;
  timeoutRef.current = onTimeout;

  const centre = useNotifications();
  const streamOpen = centre !== null && centre.streamState === 'open';
  const notifications = centre?.notifications;

  // Server events: a row that is new (or changed) since the list was first seen, and matches.
  const seen = useRef<{ scope: string | null; versions: Map<string, string> } | null>(null);
  useEffect(() => {
    if (!notifications || centre?.isLoading) return;
    const known = seen.current;
    if (known === null || known.scope !== scopeId) {
      seen.current = { scope: scopeId, versions: new Map(notifications.map((n) => [n.id, versionOf(n)])) };
      return;
    }
    let relevant = false;
    for (const n of notifications) {
      const version = versionOf(n);
      if (known.versions.get(n.id) !== version) {
        known.versions.set(n.id, version);
        if (isRelevantEvent(n, scopeId)) relevant = true;
      }
    }
    if (relevant) void refetchRef.current();
  }, [notifications, centre?.isLoading, scopeId]);

  // The fallback: fast while the stream is not open, a slow safety net while it is.
  useEffect(() => {
    if (!active) return;
    const startedAt = Date.now();
    const timer = window.setInterval(
      () => {
        if (Date.now() - startedAt >= POLL_MAX_MS) {
          window.clearInterval(timer);
          timeoutRef.current?.();
          return;
        }
        void refetchRef.current();
      },
      streamOpen ? SAFETY_POLL_INTERVAL_MS : POLL_INTERVAL_MS,
    );
    return () => window.clearInterval(timer);
  }, [active, scopeId, streamOpen]);
}
