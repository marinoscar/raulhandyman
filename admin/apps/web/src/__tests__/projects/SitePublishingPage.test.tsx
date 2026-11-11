import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { ADMIN_SECTIONS } from '../../config/adminSections';
import { SitePublishingPage } from '../../pages/SitePublishingPage';
import { calls, renderWithHost } from './fixtures';

const status = {
  contentVersion: 'v7',
  lastBuildVersion: 'v7',
  lastBuildAt: '2026-01-02T03:04:05.000Z',
  lastBuildStatus: 'success',
  lastBuildError: null,
  lastPing: { at: '2026-01-02T03:05:00.000Z', status: 200, error: null, urlCount: 3 },
};
const projectsSettings = {
  brand: { navy: '#0e1f3d', gold: '#d6a84e', businessName: 'Business Alpha', phoneDisplay: '555-0100', logoObjectId: null },
  grade: { warmth: 0.06, saturation: 1.06 },
  og: { enabled: true },
};
const doc = { version: 4, projects: projectsSettings };

function setup(permissions: string[], responses: Record<string, unknown> = {}) {
  return renderWithHost(
    <SitePublishingPage />,
    {
      permissions,
      responses: {
        'GET /site/status': status,
        'GET /site/indexnow/key': { configured: false, key: null, keyLocation: null, updatedAt: null },
        'GET /system-settings': doc,
        ...responses,
      },
    },
  );
}

describe('Site publishing card', () => {
  it('is in the admin registry with the permission the IndexNow routes enforce', () => {
    const card = ADMIN_SECTIONS.flatMap((s) => s.cards).find((c) => c.path === '/admin/settings/site-publishing');
    expect(card?.permission).toBe('projects:publish');
  });

  it('shows the build status and the last IndexNow ping', async () => {
    setup(['projects:publish']);
    expect(await screen.findByText(/Content version: v7/)).toBeInTheDocument();
    expect(screen.getByTestId('build-state')).toHaveTextContent('success');
    expect(screen.getByText(/status 200, 3 URLs/)).toBeInTheDocument();
    expect(screen.getByText(/docs\/runbook-admin\.md/)).toBeInTheDocument();
  });

  it('explains the build token honestly', () => {
    setup(['projects:publish']);
    expect(screen.getByText(/cannot be limited to a single permission/)).toBeInTheDocument();
    expect(screen.getByText('/opt/infra/apps/raulhandyman/.content-token')).toBeInTheDocument();
  });

  it('generates an IndexNow key through the API and shows it', async () => {
    const user = userEvent.setup();
    const generated = { configured: true, key: 'a'.repeat(32), keyLocation: `https://example.test/${'a'.repeat(32)}.txt`, updatedAt: null };
    const { host } = setup(['projects:publish'], { 'POST /site/indexnow/key': generated });
    await user.click(await screen.findByRole('button', { name: 'Generate key' }));
    await waitFor(() => expect(calls(host, 'POST /site/indexnow/key')).toHaveLength(1));
    expect(await screen.findByTestId('indexnow-state')).toHaveTextContent('a'.repeat(32));
  });

  it('clears the key after a confirmation click', async () => {
    const user = userEvent.setup();
    const configured = { configured: true, key: 'b'.repeat(32), keyLocation: 'https://example.test/k.txt', updatedAt: null };
    const { host } = setup(['projects:publish'], { 'GET /site/indexnow/key': configured, 'DELETE /site/indexnow/key': undefined });
    await user.click(await screen.findByRole('button', { name: 'Clear key' }));
    expect(calls(host, 'DELETE /site/indexnow/key')).toHaveLength(0);
    await user.click(screen.getByRole('button', { name: 'Confirm clear key' }));
    await waitFor(() => expect(calls(host, 'DELETE /site/indexnow/key')).toHaveLength(1));
  });

  it('previews a warmth change and saves the projects namespace with If-Match', async () => {
    const user = userEvent.setup();
    const { host } = setup(['projects:publish', 'system_settings:read', 'system_settings:write'], { 'PATCH /system-settings': { ...doc, version: 5 } });
    const slider = await screen.findByRole('slider', { name: /Warmth/ });
    const before = screen.getByTestId('grade-preview-after').getAttribute('style');
    fireEvent.change(slider, { target: { value: '0.12' } });
    await waitFor(() => expect(screen.getByText('Warmth: 0.120')).toBeInTheDocument());
    const after = screen.getByTestId('grade-preview-after').getAttribute('style');
    expect(after).not.toBe(before);
    expect(after).toContain('sepia(0.300)');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(calls(host, 'PATCH /system-settings')).toHaveLength(1));
    const request = calls(host, 'PATCH /system-settings')[0]!;
    expect(request.ifMatch).toBe('4');
    expect(JSON.stringify(request.body)).toContain('"warmth":0.12');
    expect(await screen.findByText(/Saved\./)).toBeInTheDocument();
  });

  it('is read-only without system_settings:write', async () => {
    setup(['projects:publish', 'system_settings:read']);
    expect(await screen.findByLabelText('Business name')).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument();
    expect(screen.getByText(/Read-only/)).toBeInTheDocument();
  });
});
