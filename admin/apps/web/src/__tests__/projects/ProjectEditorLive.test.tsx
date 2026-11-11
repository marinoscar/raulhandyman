import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { ProjectEditorPage } from '../../pages/ProjectEditorPage';
import { catalog, calls, ID, photo, project, P1, renderWithHost } from './fixtures';

const base = (extra: Record<string, unknown>, permissions = ['projects:read', 'projects:write', 'projects:publish', 'ai:use']) =>
  renderWithHost(<ProjectEditorPage />, {
    route: `/projects/${ID}`,
    path: '/projects/:id',
    permissions,
    responses: { 'GET /projects/catalog': catalog, 'GET /ai/config': { enabled: true }, 'GET /site/status': { contentVersion: 'a', lastBuildVersion: 'a', lastBuildAt: null, lastBuildStatus: 'success', lastBuildError: null }, ...extra },
  });

describe('live updates (polling fallback)', () => {
  beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }));
  afterEach(() => vi.useRealTimers());

  it('refetches every 3 seconds while a photo is processing, then stops', async () => {
    let reads = 0;
    const { host } = base({
      [`GET /projects/${ID}`]: () => (++reads < 3 ? project({ photos: [photo(P1, { processingStatus: 'processing' })] }) : project({ photos: [photo(P1)] })),
    });
    expect(await screen.findByText('Processing')).toBeInTheDocument();
    await act(async () => {});
    await act(async () => {
      vi.advanceTimersByTime(3100);
    });
    await act(async () => {
      vi.advanceTimersByTime(3100);
    });
    expect(await screen.findByText('Ready')).toBeInTheDocument();
    const after = calls(host, `GET /projects/${ID}`).length;
    await act(async () => {
      vi.advanceTimersByTime(12_000);
    });
    expect(calls(host, `GET /projects/${ID}`).length).toBe(after);
  });

  it('shows a finished AI suggestion once the poll returns it', async () => {
    const suggestion = { createdAt: 'now', output: { titleOptions: ['Drywall patch finished in Town Alpha', 'b'.repeat(12), 'c'.repeat(12)], slug: 'x-y-z', seoTitle: 'Suggested SEO title for the wall', metaDescription: 'm'.repeat(80), summary: 's', body: 'b', warnings: [] } };
    let reads = 0;
    base({
      [`GET /projects/${ID}`]: () => (++reads < 2 ? project() : project({ aiSuggestion: suggestion })),
      [`POST /projects/${ID}/ai/suggest`]: { jobId: 'j' },
    });
    const button = await screen.findByRole('button', { name: /Suggest with AI/ });
    await waitFor(() => expect(button).toBeEnabled());
    await userEvent.setup({ advanceTimers: vi.advanceTimersByTime }).click(button);
    expect(await screen.findByRole('progressbar', { name: 'AI suggestion in progress' })).toBeInTheDocument();
    await act(async () => {});
    await act(async () => {
      vi.advanceTimersByTime(3100);
    });
    expect(await screen.findByRole('group', { name: 'Suggestion for SEO title' })).toBeInTheDocument();
    expect(screen.queryByRole('progressbar', { name: 'AI suggestion in progress' })).not.toBeInTheDocument();
  });
});

describe('permissions', () => {
  it('hides the publish bar without projects:publish and disables editing without projects:write', async () => {
    base({ [`GET /projects/${ID}`]: project() }, ['projects:read']);
    expect(await screen.findByLabelText('Title')).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Publish' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Suggest with AI/ })).not.toBeInTheDocument();
  });

  it('shows the publish bar with projects:publish', async () => {
    base({ [`GET /projects/${ID}`]: project() });
    expect(await screen.findByRole('button', { name: 'Publish' })).toBeInTheDocument();
    // An empty draft has SEO errors, so publishing is blocked with the reason.
    expect(screen.getByRole('button', { name: 'Publish' })).toBeDisabled();
    expect(screen.getByText(/errors? before publishing/)).toBeInTheDocument();
  });

  it('says when the project is not found', async () => {
    const { createTestApiError } = await import('@marinoscar/platform-web/testing');
    base({
      [`GET /projects/${ID}`]: () => {
        throw createTestApiError(404, 'Not found');
      },
    });
    expect(await screen.findByText('This project does not exist (or was deleted).')).toBeInTheDocument();
  });
});
