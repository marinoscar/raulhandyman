import { render, screen } from '@testing-library/react';
import { PlatformHostProvider } from '@marinoscar/platform-web/core';
import { createTestPlatformHost } from '@marinoscar/platform-web/testing';

import { NotesPage, type Note } from '../pages/NotesPage';

const notes: Note[] = [{ id: 'n1', title: 'Plan the launch', body: '', archived: false }];

describe('NotesPage', () => {
  it('lists the notes the API returns, through the platform host', async () => {
    const host = createTestPlatformHost({ permissions: ['notes:read', 'notes:write'], responses: { 'GET /notes': notes } });
    render(
      <PlatformHostProvider host={host}>
        <NotesPage />
      </PlatformHostProvider>,
    );

    expect(await screen.findByText('Plan the launch')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add' })).toBeInTheDocument();
    expect(host.requests.map((request) => `${request.method} ${request.path}`)).toEqual(['GET /notes']);
  });

  it('hides the editing controls from a reader', async () => {
    const host = createTestPlatformHost({ permissions: ['notes:read'], responses: { 'GET /notes': notes } });
    render(
      <PlatformHostProvider host={host}>
        <NotesPage />
      </PlatformHostProvider>,
    );

    expect(await screen.findByText('Plan the launch')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add' })).not.toBeInTheDocument();
  });
});
