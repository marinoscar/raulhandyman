import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createTestApiError } from '@marinoscar/platform-web/testing';

import { ProjectEditorPage } from '../../pages/ProjectEditorPage';
import { AUTOSAVE_DEBOUNCE_MS } from '../../projects/editor';
import type { Project } from '../../projects/types';
import { catalog, calls, ID, photo, project, P1, renderWithHost, summary } from './fixtures';

const route = `/projects/${ID}`;
const path = '/projects/:id';
const permissions = ['projects:read', 'projects:write', 'ai:use'];

const suggestion = {
  model: 'test-model',
  createdAt: '2026-02-01T00:00:00.000Z',
  runId: 'run-1',
  output: {
    titleOptions: ['Drywall patch finished in Town Alpha', 'Hallway wall repaired in Town Alpha', 'Smooth wall repair in Town Alpha'],
    slug: 'drywall-patch-town-alpha',
    seoTitle: 'Drywall Repair in Town Alpha, TX | Clean Patch',
    metaDescription: 'A hallway wall patched, sanded and painted to match. Ask about drywall repair.',
    summary: 'A patched hallway wall.',
    body: 'The wall had a hole.',
    warnings: ["The notes mention a ladder but it isn't visible in the photos"],
  },
};

function setup(overrides: { project?: Project; ai?: boolean; extra?: Record<string, unknown>; perms?: string[] } = {}) {
  const current = overrides.project ?? project();
  return renderWithHost(<ProjectEditorPage />, {
    route,
    path,
    permissions: overrides.perms ?? permissions,
    responses: {
      'GET /projects/catalog': catalog,
      [`GET /projects/${ID}`]: current,
      'GET /ai/config': { enabled: overrides.ai ?? true },
      'GET /site/status': { contentVersion: 'v1', lastBuildVersion: 'v1', lastBuildAt: null, lastBuildStatus: 'success', lastBuildError: null },
      [`PATCH /projects/${ID}`]: (request: { body?: unknown }) => ({ ...summary(), ...(request.body as object), version: 4 }),
      ...overrides.extra,
    },
  });
}

describe('ProjectEditorPage', () => {
  describe('autosave', () => {
    beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }));
    afterEach(() => vi.useRealTimers());

    it('saves one second after the last edit, with If-Match, and shows the state', async () => {
      const { host } = setup();
      const title = await screen.findByLabelText('Title');
      fireEvent.change(title, { target: { value: 'Wall repair, new title' } });
      expect(screen.getByText('Unsaved')).toBeInTheDocument();

      await act(async () => {
        vi.advanceTimersByTime(AUTOSAVE_DEBOUNCE_MS - 50);
      });
      expect(calls(host, 'PATCH')).toHaveLength(0);

      fireEvent.change(title, { target: { value: 'Wall repair, newer title' } });
      await act(async () => {
        vi.advanceTimersByTime(AUTOSAVE_DEBOUNCE_MS - 50);
      });
      expect(calls(host, 'PATCH')).toHaveLength(0); // the second keystroke restarted the debounce

      await act(async () => {
        vi.advanceTimersByTime(100);
      });
      await waitFor(() => expect(calls(host, 'PATCH')).toHaveLength(1));
      expect(calls(host, 'PATCH')[0]).toMatchObject({ path: `/projects/${ID}`, body: { title: 'Wall repair, newer title' }, ifMatch: '3' });
      expect(await screen.findByText('Saved ✓')).toBeInTheDocument();
    });

    it('reloads and says so when the project changed on another device (412)', async () => {
      const server = project({ title: 'Edited elsewhere', version: 9 });
      let reads = 0;
      const { host } = setup({
        extra: {
          [`GET /projects/${ID}`]: () => (reads++ === 0 ? project() : server),
          [`PATCH /projects/${ID}`]: () => {
            throw createTestApiError(412, 'Stale version');
          },
        },
      });
      fireEvent.change(await screen.findByLabelText('Title'), { target: { value: 'My local edit' } });
      await act(async () => {
        vi.advanceTimersByTime(AUTOSAVE_DEBOUNCE_MS + 10);
      });

      expect(await screen.findByText('This project changed on another device — reloaded')).toBeInTheDocument();
      expect(screen.getByLabelText('Title')).toHaveValue('Edited elsewhere');
      expect(calls(host, 'GET /projects/' + ID).length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('AI suggestions', () => {
    it('disables "Suggest with AI" when AI is off', async () => {
      setup({ ai: false });
      const button = await screen.findByRole('button', { name: /Suggest with AI/ });
      await waitFor(() => expect(button).toBeDisabled());
    });

    it('disables it without the ai:use permission', async () => {
      setup({ perms: ['projects:read', 'projects:write'] });
      expect(await screen.findByRole('button', { name: /Suggest with AI/ })).toBeDisabled();
    });

    it('starts a suggestion with POST /ai/suggest', async () => {
      const { host } = setup({ extra: { [`POST /projects/${ID}/ai/suggest`]: { jobId: 'job-1' } } });
      const button = await screen.findByRole('button', { name: /Suggest with AI/ });
      await waitFor(() => expect(button).toBeEnabled());
      await userEvent.click(button);
      await waitFor(() => expect(calls(host, `POST /projects/${ID}/ai/suggest`)).toHaveLength(1));
      expect(await screen.findByRole('progressbar', { name: 'AI suggestion in progress' })).toBeInTheDocument();
    });

    it('shows the warnings and a chip per suggested field; Use applies exactly one field', async () => {
      const applied = project({ seoTitle: suggestion.output.seoTitle, aiSuggestion: suggestion, version: 4 });
      let reads = 0;
      const { host } = setup({
        project: project({ aiSuggestion: suggestion }),
        extra: {
          [`GET /projects/${ID}`]: () => (reads++ === 0 ? project({ aiSuggestion: suggestion }) : applied),
          [`POST /projects/${ID}/ai/apply`]: summary({ version: 4 }),
        },
      });
      expect(await screen.findByText(/The notes mention a ladder/)).toBeInTheDocument();
      const group = await screen.findByRole('group', { name: 'Suggestion for SEO title' });
      expect(within(group).getByText(suggestion.output.seoTitle)).toBeInTheDocument();

      await userEvent.click(screen.getByRole('button', { name: 'Use suggested SEO title' }));

      await waitFor(() => expect(calls(host, `POST /projects/${ID}/ai/apply`)).toHaveLength(1));
      expect(calls(host, `POST /projects/${ID}/ai/apply`)[0]).toMatchObject({ body: { project: ['seoTitle'] }, ifMatch: '3' });
      await waitFor(() => expect(screen.getByLabelText('SEO title')).toHaveValue(suggestion.output.seoTitle));
      expect(screen.getByLabelText('Meta description')).toHaveValue('');
    });

    it('offers three title options and applies the selected one', async () => {
      const { host } = setup({ project: project({ aiSuggestion: suggestion }), extra: { [`POST /projects/${ID}/ai/apply`]: summary({ version: 4 }) } });
      await userEvent.click(await screen.findByRole('radio', { name: 'Hallway wall repaired in Town Alpha' }));
      await userEvent.click(screen.getByRole('button', { name: 'Use selected title' }));
      await waitFor(() => expect(calls(host, `POST /projects/${ID}/ai/apply`)).toHaveLength(1));
      expect(calls(host, `POST /projects/${ID}/ai/apply`)[0]).toMatchObject({ body: { project: ['title'], titleOption: 1 } });
    });

    it('"Apply all" sends every suggested field, the chosen title and the photo fields', async () => {
      const p = photo(P1, { aiSuggestion: { output: { altText: 'A patched hallway wall, sanded smooth', caption: 'After the patch' } } });
      const { host } = setup({ project: project({ aiSuggestion: suggestion, photos: [p] }), extra: { [`POST /projects/${ID}/ai/apply`]: summary({ version: 4 }) } });
      await userEvent.click(await screen.findByRole('button', { name: 'Apply all' }));
      await waitFor(() => expect(calls(host, `POST /projects/${ID}/ai/apply`)).toHaveLength(1));
      expect(calls(host, `POST /projects/${ID}/ai/apply`)[0]?.body).toEqual({
        project: ['title', 'slug', 'seoTitle', 'metaDescription', 'summary', 'body'],
        titleOption: 0,
        photos: [{ photoId: P1, fields: ['altText', 'caption'] }],
      });
    });

    it('"Another option" asks to regenerate just that field', async () => {
      const { host } = setup({ project: project({ aiSuggestion: suggestion }), extra: { [`POST /projects/${ID}/ai/regenerate`]: { jobId: 'job-2' } } });
      await userEvent.click(await screen.findByRole('button', { name: 'Another option for meta description' }));
      await waitFor(() => expect(calls(host, `POST /projects/${ID}/ai/regenerate`)).toHaveLength(1));
      expect(calls(host, `POST /projects/${ID}/ai/regenerate`)[0]?.body).toEqual({ field: 'metaDescription' });
    });
  });

  it('labels every input and keeps the slug locked once published', async () => {
    setup({ project: project({ status: 'published', slug: 'wall-repair-town-alpha' }) });
    for (const label of ['Service', 'Town', 'Completed on', 'Work notes', 'Title', 'SEO title', 'Meta description', 'Summary']) {
      expect(await screen.findByLabelText(label, { selector: 'input, textarea, [role="combobox"]' })).toBeInTheDocument();
    }
    expect(screen.getByLabelText('Slug')).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: 'Unlock slug' }));
    expect(await screen.findByText(/creates a redirect from the old one to the new one/)).toBeInTheDocument();
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Unlock slug' }));
    await waitFor(() => expect(screen.getByLabelText('Slug')).toBeEnabled());
    expect(screen.getByText('Changing the address creates a redirect from the old one.')).toBeInTheDocument();
  });

  it('shows the counters', async () => {
    setup({ project: project({ title: 'Hello', seoTitle: 'Short' }) });
    expect(await screen.findByText('5/70')).toBeInTheDocument();
    expect(screen.getByText('5/60')).toBeInTheDocument();
    expect(screen.getByText('0/155')).toBeInTheDocument();
  });
});
