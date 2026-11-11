import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createTestApiError } from '@marinoscar/platform-web/testing';

import { PublishBar, type PublishBarProps } from '../../projects/PublishBar';
import type { LintResult } from '../../projects/types';
import { ID, renderWithHost, summary, calls } from './fixtures';

const clean: LintResult = { errors: [], warnings: [{ code: 'photo.caption_empty', field: 'caption', message: 'Add a caption.' }], score: 96 };
const broken: LintResult = {
  errors: [
    { code: 'title.missing', field: 'title', message: 'Title must be at least 10 characters.' },
    { code: 'body.missing', field: 'body', message: 'The description needs at least 60 words (now 0).' },
  ],
  warnings: [],
  score: 76,
};

const status = (overrides: object = {}) => ({ contentVersion: 'v2', lastBuildVersion: 'v1', lastBuildAt: null, lastBuildStatus: 'success', lastBuildError: null, ...overrides });

function setup(props: Partial<PublishBarProps> = {}, responses: Record<string, unknown> = {}) {
  const onChanged = vi.fn();
  const onConflict = vi.fn(async () => false);
  const view = renderWithHost(
    <PublishBar
      project={{ id: ID, slug: 'wall-repair', status: 'draft', version: 3 }}
      lint={clean}
      saveState="saved"
      prepare={async () => 3}
      onConflict={onConflict}
      onChanged={onChanged}
      {...props}
    />,
    { permissions: ['projects:publish'], responses: { 'GET /site/status': status(), ...responses } },
  );
  return { ...view, onChanged, onConflict };
}

/** Lets React run the effects that start the polling before the fake clock moves. */
const settle = () => act(async () => {});

describe('PublishBar', () => {
  it('disables Publish while errors exist and says why', () => {
    setup({ lint: broken });
    expect(screen.getByRole('button', { name: 'Publish' })).toBeDisabled();
    expect(screen.getByText('Fix 2 errors before publishing.')).toBeInTheDocument();
  });

  it('waits for unsaved edits to save', () => {
    setup({ saveState: 'unsaved' });
    expect(screen.getByRole('button', { name: 'Publish' })).toBeDisabled();
  });

  it('confirms with the warnings, then publishes with If-Match', async () => {
    const user = userEvent.setup();
    const { host, onChanged } = setup({}, { [`POST /projects/${ID}/publish`]: { ...summary({ status: 'published', version: 4 }), contentVersion: 'v2' } });
    await user.click(screen.getByRole('button', { name: 'Publish' }));
    const dialog = await screen.findByRole('dialog', { name: 'Publish this project?' });
    expect(within(dialog).getByText('Add a caption.')).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Publish now' }));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(calls(host, `POST /projects/${ID}/publish`)[0]).toMatchObject({ headers: { 'If-Match': '3' } });
  });

  it('shows the server errors of a 422', async () => {
    const user = userEvent.setup();
    setup(
      {},
      {
        [`POST /projects/${ID}/publish`]: () => {
          throw createTestApiError(422, 'does not meet SEO requirements', undefined, { errors: [{ code: 'slug.duplicate', field: 'slug', message: 'Another project already uses this slug (or used it before).' }] });
        },
      },
    );
    await user.click(screen.getByRole('button', { name: 'Publish' }));
    await user.click(await screen.findByRole('button', { name: 'Publish now' }));
    expect(await screen.findByText('The server found problems that block publishing:')).toBeInTheDocument();
    expect(screen.getByText('Another project already uses this slug (or used it before).')).toBeInTheDocument();
  });

  it('hands a 412 to the page instead of showing an error', async () => {
    const user = userEvent.setup();
    const { onConflict } = setup(
      {},
      {
        [`POST /projects/${ID}/publish`]: () => {
          throw createTestApiError(412, 'Stale');
        },
      },
    );
    onConflict.mockResolvedValue(true);
    await user.click(screen.getByRole('button', { name: 'Publish' }));
    await user.click(await screen.findByRole('button', { name: 'Publish now' }));
    await waitFor(() => expect(onConflict).toHaveBeenCalled());
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('offers Unpublish and View on site for a published project', async () => {
    const user = userEvent.setup();
    const { host } = setup(
      { project: { id: ID, slug: 'wall-repair', status: 'published', version: 4 } },
      { [`POST /projects/${ID}/unpublish`]: { ...summary({ status: 'draft', version: 5 }), contentVersion: 'v3' } },
    );
    expect(screen.getByRole('link', { name: /View on site/ })).toHaveAttribute('href', 'https://raulhandyman.net/projects/wall-repair/');
    expect(screen.queryByRole('button', { name: 'Publish' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Unpublish' }));
    await waitFor(() => expect(calls(host, `POST /projects/${ID}/unpublish`)).toHaveLength(1));
  });

  describe('live status', () => {
    beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }));
    afterEach(() => vi.useRealTimers());

    it('moves from waiting to live as the build catches up', async () => {
      let reads = 0;
      setup({ project: { id: ID, slug: 'wall-repair', status: 'published', version: 4 } }, { 'GET /site/status': () => (reads++ < 1 ? status() : status({ lastBuildVersion: 'v2' })) });
      expect(await screen.findByText('Waiting for site update (usually 2–4 min)')).toBeInTheDocument();
      await settle();
      await act(async () => {
        vi.advanceTimersByTime(3100);
      });
      expect(await screen.findByText('Live ✓')).toBeInTheDocument();
    });

    it('reports a failed build', async () => {
      let reads = 0;
      setup({ project: { id: ID, slug: 'wall-repair', status: 'published', version: 4 } }, { 'GET /site/status': () => (reads++ < 1 ? status() : status({ lastBuildStatus: 'failed', lastBuildError: 'boom' })) });
      expect(await screen.findByText('Waiting for site update (usually 2–4 min)')).toBeInTheDocument();
      await settle();
      await act(async () => {
        vi.advanceTimersByTime(3100);
      });
      expect(await screen.findByText('Site update failed — admins notified')).toBeInTheDocument();
    });

    it('stops polling after two minutes', async () => {
      const { host } = setup({ project: { id: ID, slug: 'wall-repair', status: 'published', version: 4 } }, {});
      await screen.findByText('Waiting for site update (usually 2–4 min)');
      await settle();
      await act(async () => {
        vi.advanceTimersByTime(125_000);
      });
      const reads = calls(host, 'GET /site/status').length;
      await act(async () => {
        vi.advanceTimersByTime(30_000);
      });
      expect(calls(host, 'GET /site/status').length).toBe(reads);
      expect(reads).toBeLessThanOrEqual(42);
    });
  });
});
