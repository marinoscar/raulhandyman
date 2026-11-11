import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createTestApiError } from '@marinoscar/platform-web/testing';

import { ProjectsPage } from '../../pages/ProjectsPage';
import { catalog, calls, ID, renderWithHost, summary } from './fixtures';

const list = (items = [summary({ coverThumbUrl: 'https://img.example.test/a/thumb.webp', lintErrorCount: 2 }), summary({ id: 'p2', title: 'Fence fix', status: 'published', lintErrorCount: 0 })]) => ({
  items,
  page: 1,
  pageSize: 20,
  total: items.length,
  totalPages: 1,
});

const base = { permissions: ['projects:read', 'projects:write'] };
// The DataTable keeps its layout in the user's settings.
const settings = { 'GET /user-settings': {}, 'PUT /user-settings': {}, 'PATCH /user-settings': {} };

const queries = (host: { requests: Array<{ path: string }> }) => host.requests.map((r) => r.path).filter((p) => p.startsWith('/projects?'));

describe('ProjectsPage', () => {
  it('lists the projects with status chips and the lint state', async () => {
    renderWithHost(<ProjectsPage />, { ...base, responses: { ...settings, 'GET /projects': list(), 'GET /projects/catalog': catalog } });

    expect(await screen.findByRole('link', { name: 'Wall repair in Town Alpha' })).toHaveAttribute('href', `/projects/${ID}`);
    expect(screen.getByText('Fence fix')).toBeInTheDocument();
    expect(screen.getByText('Draft')).toBeInTheDocument();
    expect(screen.getByText('Published')).toBeInTheDocument();
    expect(screen.getByText('2 errors')).toBeInTheDocument();
    expect(await screen.findAllByText('Drywall repair')).not.toHaveLength(0);
  });

  it('shows the empty state', async () => {
    renderWithHost(<ProjectsPage />, { ...base, responses: { ...settings, 'GET /projects': list([]), 'GET /projects/catalog': catalog } });
    expect(await screen.findByText('No projects yet — take a few photos of your next job and add it here.')).toBeInTheDocument();
  });

  it('sends the status, service and search filters to the API', async () => {
    const user = userEvent.setup();
    const { host } = renderWithHost(<ProjectsPage />, { ...base, responses: { ...settings, 'GET /projects': list(), 'GET /projects/catalog': catalog } });
    await screen.findByText('Fence fix');

    await user.click(screen.getByRole('combobox', { name: 'Status' }));
    await user.click(await screen.findByRole('option', { name: 'Draft' }));
    await waitFor(() => expect(queries(host)).toContainEqual(expect.stringContaining('status=draft')));

    await user.click(screen.getByRole('combobox', { name: 'Service' }));
    await user.click(await screen.findByRole('option', { name: 'Interior & exterior painting' }));
    await waitFor(() => expect(queries(host)).toContainEqual(expect.stringMatching(/status=draft.*service=painting|service=painting.*status=draft/)));

    await user.type(screen.getByRole('searchbox', { name: 'Search projects' }), 'fence');
    await waitFor(() => expect(queries(host)).toContainEqual(expect.stringContaining('q=fence')));
  });

  it('creates a project and opens it', async () => {
    const user = userEvent.setup();
    const { host } = renderWithHost(<ProjectsPage />, {
      ...base,
      responses: { ...settings, 'GET /projects': list(), 'GET /projects/catalog': catalog, 'POST /projects': summary({ id: 'new-id' }) },
    });
    await screen.findByText('Fence fix');

    await user.click(screen.getByRole('button', { name: /New project/ }));
    const dialog = await screen.findByRole('dialog', { name: 'New project' });
    await user.click(within(dialog).getByRole('combobox', { name: /Service/ }));
    await user.click(await screen.findByRole('option', { name: 'Drywall repair' }));
    await user.click(within(dialog).getByRole('combobox', { name: /Town/ }));
    await user.click(await screen.findByRole('option', { name: 'Town Beta' }));
    await user.type(within(dialog).getByLabelText('Notes (optional)'), 'Patched a hole');
    await user.click(within(dialog).getByRole('button', { name: 'Create project' }));

    await waitFor(() => expect(screen.getByTestId('elsewhere')).toBeInTheDocument());
    expect(calls(host, 'POST /projects')[0]).toMatchObject({ body: { serviceSlug: 'drywall-repair', townSlug: 'town-beta', workNotes: 'Patched a hole' } });
  });

  it('hides "New project" from a reader', async () => {
    renderWithHost(<ProjectsPage />, { permissions: ['projects:read'], responses: { ...settings, 'GET /projects': list(), 'GET /projects/catalog': catalog } });
    await screen.findByText('Fence fix');
    expect(screen.queryByRole('button', { name: /New project/ })).not.toBeInTheDocument();
  });

  it('explains a 403 instead of listing', async () => {
    renderWithHost(<ProjectsPage />, {
      permissions: [],
      responses: {
        'GET /projects': () => {
          throw createTestApiError(403, 'Forbidden');
        },
        'GET /projects/catalog': () => {
          throw createTestApiError(403, 'Forbidden');
        },
      },
    });
    expect(await screen.findByText("You don't have access to projects.")).toBeInTheDocument();
  });
});
