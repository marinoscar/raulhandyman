import { useEffect, useRef } from 'react';

/**
 * Issue #39 wires server events (the notifications SSE stream: `projects.ai.ready`,
 * `projects.photo.ready`, `projects.retouch.ready`, `site.build.live`,
 * `site.build.failed`). Until then the pages poll. #39 flips this constant and
 * implements the SSE branch of `useProjectLiveUpdates`; no page changes.
 */
export const USE_SERVER_EVENTS = false;

export const POLL_INTERVAL_MS = 3000;
export const POLL_MAX_MS = 120_000;

export interface LiveUpdatesOptions {
  /** True while something is processing (a photo, an AI job, a retouch, a site build). */
  active: boolean;
  /** Re-reads what is being waited for. */
  refetch: () => void | Promise<void>;
  /** Called once when the polling window ends with the work still pending. */
  onTimeout?: () => void;
}

/**
 * Keeps a page fresh while work runs in the background: with the fallback it
 * calls `refetch` every 3 seconds for at most 2 minutes after `active` turns
 * on. `scopeId` (a project id, or null for site-wide) restarts the window when
 * the page moves to another project.
 */
export function useProjectLiveUpdates(scopeId: string | null, { active, refetch, onTimeout }: LiveUpdatesOptions): void {
  const refetchRef = useRef(refetch);
  const timeoutRef = useRef(onTimeout);
  refetchRef.current = refetch;
  timeoutRef.current = onTimeout;

  useEffect(() => {
    if (!active || USE_SERVER_EVENTS) return;
    const startedAt = Date.now();
    const timer = window.setInterval(() => {
      if (Date.now() - startedAt >= POLL_MAX_MS) {
        window.clearInterval(timer);
        timeoutRef.current?.();
        return;
      }
      void refetchRef.current();
    }, POLL_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [active, scopeId]);
}
