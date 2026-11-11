import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { PlatformHostProvider } from '@marinoscar/platform-web/core';
import { ShellNavigationRail } from '@marinoscar/platform-web/shell/ui';
import { createTestPlatformHost } from '@marinoscar/platform-web/testing';

import { NAVIGATION } from '../../config/navigation';

function rail(permissions: string[]) {
  render(
    <PlatformHostProvider host={createTestPlatformHost({ permissions })}>
      <MemoryRouter>
        <ShellNavigationRail navigation={NAVIGATION} />
      </MemoryRouter>
    </PlatformHostProvider>,
  );
}

describe('the Projects navigation entry', () => {
  it('is shown first to a holder of projects:read', () => {
    rail(['projects:read']);
    const links = screen.getAllByRole('link');
    expect(links[0]).toHaveAccessibleName('Projects');
    expect(links[0]).toHaveAttribute('href', '/projects');
  });

  it('is hidden when the user lacks projects:read (what a 403 means)', () => {
    rail([]);
    expect(screen.queryByRole('link', { name: 'Projects' })).not.toBeInTheDocument();
  });
});
