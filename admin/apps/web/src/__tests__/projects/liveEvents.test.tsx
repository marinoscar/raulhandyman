import { act, screen } from '@testing-library/react';
import { useSyncExternalStore } from 'react';

import { ProjectEditorPage } from '../../pages/ProjectEditorPage';
import { PublishBar } from '../../projects/PublishBar';
import { isRelevantEvent } from '../../projects/liveUpdates';
import { catalog, calls, ID, photo, project, P1, renderWithHost } from './fixtures';

// A controllable notification centre: the real one needs the SSE connector. The hook under test
// only reads `notifications`, `streamState` and `isLoading`.
type Row = { id: string; eventKey: string; link: string | null; title: string; body: string; readAt: null; createdAt: string };
const store = vi.hoisted(() => {
  const listeners = new Set<() => void>();
  const state = { value: null as unknown };
  return {
    listeners,
    set(next: unknown) {
      state.value = next;
      listeners.forEach((l) => l());
    },
    get: () => state.value,
  };
});

vi.mock('@marinoscar/platform-web/notifications/headless', async (importActual) => ({
  ...(await importActual<Record<string, unknown>>()),
  useNotifications: () =>
    useSyncExternalStore(
      (l) => {
        store.listeners.add(l);
        return () => store.listeners.delete(l);
      },
      () => store.get(),
    ),
}));

let seq = 0;
const row = (eventKey: string, link: string | null): Row => ({ id: `n${++seq}`, eventKey, link, title: 't', body: 'b', readAt: null, createdAt: '2026-01-01T00:00:00.000Z' });
const centre = (notifications: Row[], streamState: 'open' | 'reconnecting' = 'open') => ({ notifications, streamState, isLoading: false, unreadCount: 0 });

const siteStatus = { contentVersion: 'a', lastBuildVersion: 'a', lastBuildAt: null, lastBuildStatus: 'success', lastBuildError: null };
const mountEditor = (extra: Record<string, unknown>) =>
  renderWithHost(<ProjectEditorPage />, {
    route: `/projects/${ID}`,
    path: '/projects/:id',
    permissions: ['projects:read', 'projects:write', 'projects:publish', 'ai:use'],
    responses: { 'GET /projects/catalog': catalog, 'GET /ai/config': { enabled: true }, 'GET /site/status': siteStatus, ...extra },
  });

afterEach(() => {
  store.set(null);
  vi.useRealTimers();
});

describe('isRelevantEvent', () => {
  it('matches project events by the /projects/<id> link and site events for the site scope', () => {
    expect(isRelevantEvent({ eventKey: 'projects.photo_ready', link: `/projects/${ID}` }, ID)).toBe(true);
    expect(isRelevantEvent({ eventKey: 'projects.photo_ready', link: '/projects/other' }, ID)).toBe(false);
    expect(isRelevantEvent({ eventKey: 'site.build_live', link: 'https://example.test/' }, ID)).toBe(false);
    expect(isRelevantEvent({ eventKey: 'site.build_failed', link: '/admin/settings/site-publishing' }, null)).toBe(true);
    expect(isRelevantEvent({ eventKey: 'projects.ai_ready', link: `/projects/${ID}` }, null)).toBe(false);
    expect(isRelevantEvent({ eventKey: 'security.role_changed', link: `/projects/${ID}` }, ID)).toBe(false);
  });
});

describe('live updates from server events', () => {
  beforeEach(() => {
    seq = 0;
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  it('refetches the project when its event arrives, ignores other projects, and does not poll every 3 seconds', async () => {
    store.set(centre([]));
    let reads = 0;
    const { host } = mountEditor({
      [`GET /projects/${ID}`]: () => (++reads < 2 ? project({ photos: [photo(P1, { processingStatus: 'processing' })] }) : project({ photos: [photo(P1)] })),
    });
    expect(await screen.findByText('Processing')).toBeInTheDocument();
    await act(async () => {});
    await act(async () => {
      vi.advanceTimersByTime(9500);
    });
    expect(calls(host, `GET /projects/${ID}`)).toHaveLength(1);

    await act(async () => store.set(centre([row('projects.photo_ready', '/projects/someone-else')])));
    expect(calls(host, `GET /projects/${ID}`)).toHaveLength(1);

    await act(async () => store.set(centre([row('projects.photo_ready', `/projects/${ID}`), ...(store.get() as { notifications: Row[] }).notifications])));
    expect(await screen.findByText('Ready')).toBeInTheDocument();
    expect(calls(host, `GET /projects/${ID}`)).toHaveLength(2);
  });

  it('falls back to 3 second polling while the stream is not open', async () => {
    store.set(centre([], 'reconnecting'));
    let reads = 0;
    const { host } = mountEditor({
      [`GET /projects/${ID}`]: () => (++reads < 2 ? project({ photos: [photo(P1, { processingStatus: 'processing' })] }) : project({ photos: [photo(P1)] })),
    });
    expect(await screen.findByText('Processing')).toBeInTheDocument();
    await act(async () => {});
    await act(async () => {
      vi.advanceTimersByTime(3100);
    });
    expect(await screen.findByText('Ready')).toBeInTheDocument();
    expect(calls(host, `GET /projects/${ID}`).length).toBeGreaterThanOrEqual(2);
  });

  it('refreshes the publish bar live status on site.build_live', async () => {
    store.set(centre([]));
    let reads = 0;
    renderWithHost(
      <PublishBar
        project={{ id: ID, slug: 'wall-repair', status: 'published', version: 3 }}
        lint={{ errors: [], warnings: [], score: 100 }}
        saveState="saved"
        prepare={async () => 3}
        onConflict={async () => false}
        onChanged={() => {}}
      />,
      {
        permissions: ['projects:publish'],
        responses: { 'GET /site/status': () => ({ ...siteStatus, contentVersion: 'v2', lastBuildVersion: ++reads < 2 ? 'v1' : 'v2' }) },
      },
    );
    expect(await screen.findByText(/Waiting for site update/)).toBeInTheDocument();
    await act(async () => {});
    await act(async () => store.set(centre([row('site.build_live', 'https://example.test/')])));
    expect(await screen.findByText('Live ✓')).toBeInTheDocument();
    expect(reads).toBe(2);
  });
});


